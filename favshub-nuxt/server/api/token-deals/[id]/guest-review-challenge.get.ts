/**
 * GET /api/token-deals/:id/guest-review-challenge — 获取游客评测的人机校验题
 *
 * 站点主体无社交登录资质（微信/QQ 快捷登录须企业主体），故游客评测不要求登录。
 * 为防止脚本刷评，提交前需先答一道算术题 —— 答案以 HMAC 签名令牌下发，
 * **服务端不存 session**，零依赖、零外部服务，重启也不影响在途挑战。
 *
 * 返回：{ question: '3 + 7 = ?', token: '<签名令牌>', expires_in: 600 }
 * 提交时把 token 与答案一并回传即可。
 */
import { getRawDb } from '../../../database'
import { createGuestChallenge } from '../../../utils/guest-reviews'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '缺少通告 ID' } })
  }

  const db = getRawDb()
  const deal = db.prepare('SELECT id, status FROM token_deals WHERE id = ?').get(id) as any
  if (!deal || deal.status !== 'approved') {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  return createGuestChallenge()
})
