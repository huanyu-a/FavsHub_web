/**
 * POST /api/token-deals/:id/guest-reviews — 提交游客评测（无需登录）
 *
 * Body: {
 *   nickname: string,          // 必填，最长 24 字
 *   qq?: string,               // 可选，仅用于取 QQ 头像（服务端加密存储，绝不明文外泄）
 *   rating: 1-5,
 *   content: string,           // 最长 1000 字
 *   challenge_token: string,   // 人机校验令牌（来自 guest-review-challenge）
 *   challenge_answer: number,  // 人机校验答案
 * }
 *
 * 评测**默认 pending**，由通告作者或管理员审核通过后才公开并计入评分。
 *
 * 隐私：QQ 号在本端点内即被 AES-256-GCM 加密，响应只回 `avatar` URL
 * （路径为加密令牌，无密钥无法还原 QQ 号）。
 */
import { getRawDb } from '../../../database'
import { submitGuestReview } from '../../../utils/guest-reviews'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const result = submitGuestReview(getRawDb(), event, id, body)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    success: true,
    created: result.data.created,
    review: result.data.review,
    message: result.data.message,
  }
})
