/**
 * DELETE /api/token-deals/:id/guest-reviews/:reviewId — 撤回自己的待审游客评测
 *
 * 归属校验用「IP+UA 指纹」（游客无账号可依据）—— 指纹不匹配一律 404，
 * 与全局隔离策略一致（不区分「不存在」与「无权限」）。
 * 管理员可撤回任意待审评测。
 */
import { getRawDb } from '../../../../database'
import { withdrawGuestReview } from '../../../../utils/guest-reviews'

export default defineEventHandler(async (event) => {
  const { reviewId } = getRouterParams(event)

  const result = withdrawGuestReview(getRawDb(), event, reviewId)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return { success: true, id: result.data.id }
})