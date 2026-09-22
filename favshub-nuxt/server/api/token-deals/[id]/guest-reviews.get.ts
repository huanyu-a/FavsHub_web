/**
 * GET /api/token-deals/:id/guest-reviews — 该通告已通过的游客评测（公开可读）
 *
 * Query: page, limit（默认 10，上限 50）
 *
 * **只返回 status='approved'** —— pending 与 rejected 绝不外泄，
 * 否则等于绕过审核把未审内容公开出去。
 */
import { getRawDb } from '../../../database'
import { listGuestReviews } from '../../../utils/guest-reviews'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const query = getQuery(event)

  const result = listGuestReviews(getRawDb(), id, query)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    reviews: result.data.reviews,
    total: result.data.total,
  }
})
