/**
 * POST /api/token-deals/:id/review-marks — 给一条评测打「有用」标
 * Body: { review_id: string }
 *
 * 无需登录（游客可打标），点一次标上、再点一次取消。
 * 身份由第一方 cookie + UA 派生（与游客评测同一套），不存明文 IP。
 * 返回最新计数，前端就地更新，无需重拉列表。
 */
import { getRawDb } from '../../../database'
import { toggleReviewMark } from '../../../utils/review-marks'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const result = toggleReviewMark(getRawDb(), event, id, body?.review_id)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return { success: true, ...result.data }
})