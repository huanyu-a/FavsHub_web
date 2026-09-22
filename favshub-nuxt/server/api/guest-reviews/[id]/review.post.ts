/**
 * POST /api/guest-reviews/:id/review — 审核游客评测
 *
 * Body: { action: 'approve' | 'reject', reason?: string }
 *
 * 权限：通告作者或管理员（管理员可审核所有通告上的评测）。他人一律 404。
 * 通过后该评测计入通告评分（rating_sum / rating_count 重算）。
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { reviewGuestReview } from '../../../utils/guest-reviews'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }

  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const result = reviewGuestReview(getRawDb(), role, id, body)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    success: true,
    review: result.data.review,
    message: result.data.message,
  }
})