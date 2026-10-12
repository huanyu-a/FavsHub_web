/**
 * POST /api/token-deals/:id/reviews — 提交或更新评测
 * Body: { rating: 1-5, content: string }
 *
 * 一人一评：重复提交视为更新。写入后在同一事务内重算主表缓存计数。
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { syncDealCounters, LIMITS } from '../../../utils/token-deals'
import { checkRateLimit, getClientIP } from '../../../utils/rate-limit'
import { hasSpamText } from '../../../utils/spam'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)

  // 限频：登录评测即时公开且无审核，缺这道闸时「批量注册 → 灌评分」几乎无成本
  // （游客评测反而有限频 + 内容过滤）。重复提交按更新计，故额度放宽。
  checkRateLimit(`review:u${user.id}`, LIMITS.reviewPerUserPerHour, 3_600_000)
  checkRateLimit(`review:ip:${getClientIP(event)}`, LIMITS.reviewPerIpPerHour, 3_600_000)

  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const rating = Number(body?.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw createError({ statusCode: 400, data: { error: '评分必须是 1-5 的整数' } })
  }

  const content = String(body?.content ?? '').trim()
  if (!content) {
    throw createError({ statusCode: 400, data: { error: '评测内容不能为空' } })
  }
  if (content.length > LIMITS.reviewContent) {
    throw createError({ statusCode: 400, data: { error: `评测内容不能超过 ${LIMITS.reviewContent} 字` } })
  }
  // 与游客评测同一份广告/灌水黑名单（登录用户同样能批量注册出来）
  if (hasSpamText(content)) {
    throw createError({ statusCode: 400, data: { error: '内容包含疑似广告或违规信息，请修改后重试' } })
  }

  const db = getRawDb()
  const deal = db.prepare('SELECT id FROM token_deals WHERE id = ?').get(id)
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  const now = Date.now()

  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO token_deal_reviews (deal_id, user_id, rating, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(deal_id, user_id)
        DO UPDATE SET rating = excluded.rating, content = excluded.content, updated_at = excluded.updated_at
      `).run(id, user.id, rating, content, now, now)
      syncDealCounters(db, id)
    })()
  } catch (err: any) {
    console.error('提交评测失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '提交失败' } })
  }

  const counters = db.prepare(
    'SELECT rating_sum, rating_count FROM token_deals WHERE id = ?'
  ).get(id) as { rating_sum: number; rating_count: number }

  return {
    success: true,
    rating_sum: counters.rating_sum,
    rating_count: counters.rating_count,
    average: counters.rating_count > 0
      ? Number((counters.rating_sum / counters.rating_count).toFixed(1))
      : null,
  }
})
