/**
 * GET /api/guest-reviews — 待我审核的游客评测
 *
 * Query: page, limit（默认 50）
 *
 * 范围：
 *   - 管理员 → 全部通告上的待审游客评测（scope:'all'）
 *   - 普通用户 → 只包含自己发布的通告上的（scope:'own'）
 *
 * 仅返回 `pending`：已结案的评测在通告详情里可见。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { listReviewableGuestReviews, guestReviewPendingCount } from '../../utils/guest-reviews'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }

  const query = getQuery(event)
  const db = getRawDb()

  const result = listReviewableGuestReviews(db, role, query)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    reviews: result.data.reviews,
    total: result.data.total,
    scope: result.data.scope,
    // 全局待审总数（不受分页影响），供角标使用
    pending_total: guestReviewPendingCount(db, role),
  }
})