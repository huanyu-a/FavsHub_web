/**
 * GET /api/token-deals/:id/guest-review-challenge — 游客评测的人机校验
 *
 * 站点主体无社交登录资质（微信/QQ 快捷登录须企业主体），故游客评测不要求登录。
 * 为防止脚本刷评，提交前须通过 Cloudflare Turnstile 人机校验。
 *
 * 下发内容：
 *   - { provider: 'turnstile', site_key }  → 前端渲染挂件，令牌随提交回传
 *   - { provider: 'disabled', message }    → 人机校验未启用，游客通道关闭
 *
 * **失败即拒绝**：不提供算术题降级，挂件加载失败或校验不通过一律拒绝提交。
 */
import { getRouterParams } from 'h3'
import { getRawDb } from '../../../database'
import { issueHumanChallenge } from '../../../utils/human-check'

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

  return issueHumanChallenge()
})
