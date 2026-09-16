/**
 * POST /api/token-deals — 发布 Token 白嫖通告
 * Body: { provider, title, url, call_url, quota, models[], region, quality, source_tag, expires_at, note }
 *
 * 管理员发布直接上线；普通用户发布进入 pending，待管理员审核。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { validateDealPayload, newDealId } from '../../utils/token-deals'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }
  const { user, isAdmin } = role

  const body = await readBody(event)
  const result = validateDealPayload(body)
  if (!result.ok) {
    throw createError({ statusCode: 400, data: { error: result.error } })
  }
  const d = result.data

  const db = getRawDb()
  const id = newDealId()
  const now = Date.now()
  const status = isAdmin ? 'approved' : 'pending'

  try {
    db.prepare(`
      INSERT INTO token_deals (
        id, user_id, provider, title, url, call_url, quota, models, region, quality,
        source_tag, expires_at, pinned, note, status, reject_reason,
        vote_up, vote_down, rating_sum, rating_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '', 0, 0, 0, 0, ?, ?)
    `).run(
      id, user.id, d.provider, d.title, d.url, d.callUrl, d.quota,
      JSON.stringify(d.models), d.region, d.quality, d.sourceTag,
      d.expiresAt, d.note, status, now, now,
    )
  } catch (err: any) {
    console.error('发布 Token 白嫖通告失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '发布失败' } })
  }

  return {
    success: true,
    deal_id: id,
    status,
    message: isAdmin ? '已发布' : '已提交，等待管理员审核',
  }
})
