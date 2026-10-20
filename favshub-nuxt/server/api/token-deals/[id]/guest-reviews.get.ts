/**
 * GET /api/token-deals/:id/guest-reviews — 该通告已通过的游客评测（公开可读）
 *
 * Query: page, limit（默认 10，上限 50）
 *
 * 可见性：与详情端点一致（已删除仅管理员、已失效/已过期仅作者与管理员），
 * 不可见时返回 404 —— 不泄露「这条通告存在过」。
 *
 * **只返回 status='approved'** —— pending 与 rejected 绝不外泄，
 * 否则等于绕过审核把未审内容公开出去。
 */
import { getRawDb } from '../../../database'
import { listGuestReviews, optionalAuthLoose } from '../../../utils/guest-reviews'
import { isAdminUserById } from '../../../utils/auth'
import { canReadDeal } from '../../../utils/token-deals'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const query = getQuery(event)

  const db = getRawDb()
  // 与详情端点同一口径（见 canReadDeal）：失效 / 过期 / 已删除的通告不给读评测，
  // 否则「详情 404 但评测列表照读」等于绕过隔离。
  const deal = db.prepare(
    'SELECT id, user_id, status, deleted_at, invalid_at, invalid_reason, expires_at'
    + ' FROM token_deals WHERE id = ?'
  ).get(id) as Record<string, any> | undefined
  const viewer = optionalAuthLoose(event)
  if (!deal || !canReadDeal(deal, {
    id: viewer?.id ?? null,
    isAdmin: isAdminUserById(viewer?.id ?? null),
  })) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  const result = listGuestReviews(db, id, query)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    reviews: result.data.reviews,
    total: result.data.total,
  }
})
