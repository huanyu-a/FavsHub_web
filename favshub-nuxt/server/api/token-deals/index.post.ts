/**
 * POST /api/token-deals — 发布 Token 白嫖通告
 * Body: { provider, title, url, call_url, quota, models[], region, quality, source_tag, expires_at, note }
 *
 * 三条通道：
 *   - 管理员：直接上线；
 *   - 登录用户：进入 pending，待管理员审核；
 *   - **游客（未登录）**：走游客通道（guest-deals.ts，需昵称 + 人机校验），
 *     同样落库 pending，待管理员审核 —— 防滥用由「人机校验 + 限频 + 内容过滤 + 后置审核」兜底。
 *
 * 游客额外字段：{ nickname, turnstile_token }（Cloudflare Turnstile 一次性令牌），
 * 登录用户的请求体里出现这些字段时会被忽略（字段级校验只读白名单）。
 * 令牌缺失 / 过期 / 校验失败 / siteverify 不可用 → 一律拒绝（fail-closed，无降级通道）。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { validateDealPayload, newDealId } from '../../utils/token-deals'
import { appendDealEvent } from '../../utils/deal-events'
import { submitGuestDeal } from '../../utils/guest-deals'
import { notifyTokenDealPending, notifyTokenDealPublished } from '../../utils/qq-notify'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  const body = await readBody(event)
  const db = getRawDb()

  // ── 游客通道：无有效登录令牌 ──
  if (!role) {
    const result = await submitGuestDeal(db, event, body)
    if (!result.ok) {
      throw createError({ statusCode: result.status, data: { error: result.error } })
    }
    // QQ 机器人通知（fire-and-forget：失败只告警，绝不阻断主请求）
    try {
      notifyTokenDealPending(result.data, `游客·${result.data.nickname}`)
    } catch (err: any) {
      console.warn('[QQBot] 通告提交通知入队失败（忽略）:', err?.message || err)
    }
    return {
      success: true,
      deal_id: result.data.dealId,
      status: 'pending',
      message: '已提交，等待管理员审核',
    }
  }

  const { user, isAdmin } = role

  const result = validateDealPayload(body)
  if (!result.ok) {
    throw createError({ statusCode: 400, data: { error: result.error } })
  }
  const d = result.data

  const id = newDealId()
  const now = Date.now()
  const status = isAdmin ? 'approved' : 'pending'

  try {
    db.prepare(`
      INSERT INTO token_deals (
        id, user_id, provider, title, url, call_url, quota, models, region, quality,
        source_tag, category, expires_at, pinned, note, status, reject_reason,
        vote_up, vote_down, rating_sum, rating_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '', 0, 0, 0, 0, ?, ?)
    `).run(
      id, user.id, d.provider, d.title, d.url, d.callUrl, d.quota,
      JSON.stringify(d.models), d.region, d.quality, d.sourceTag, d.category,
      d.expiresAt, d.note, status, now, now,
    )
  } catch (err: any) {
    console.error('发布 Token 白嫖通告失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '发布失败' } })
  }

  // 管理员直接上线 → 对外「上新」事件（登录用户落 pending，不产生事件）
  if (isAdmin) {
    appendDealEvent(db, id, 'online')
  }

  // QQ 机器人通知（fire-and-forget：失败只告警，绝不阻断主请求）
  try {
    if (isAdmin) {
      notifyTokenDealPublished(d)
    } else {
      notifyTokenDealPending(d, user.username)
    }
  } catch (err: any) {
    console.warn('[QQBot] 通告提交通知入队失败（忽略）:', err?.message || err)
  }

  return {
    success: true,
    deal_id: id,
    status,
    message: isAdmin ? '已发布' : '已提交，等待管理员审核',
  }
})
