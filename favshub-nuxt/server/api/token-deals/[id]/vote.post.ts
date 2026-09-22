/**
 * POST /api/token-deals/:id/vote — 可用性投票（还能用 / 已失效）
 * Body: { vote: 'up' | 'down' }
 *
 * **无需登录** —— 与同区块的游客评测、打标保持一致（此前仅登录用户可投，
 * 导致按钮下方提示「无需登录也能评测」与投票按钮弹「请先登录」自相矛盾）。
 *
 * 一人一票：重复投同一方向视为取消，投相反方向视为改票。
 *   - 登录用户 → 写 `token_deal_votes`（沿用原表，历史数据无缝）
 *   - 游客     → 写 `token_deal_guest_votes`（身份靠第一方 cookie + UA 指纹）
 * 投票后在同一事务内重算主表缓存计数（两表聚合）。
 *
 * 游客另有「同 IP 同通告最多计入 3 票」的上限，超限静默不落库（不报错）。
 */
import { getRawDb } from '../../../database'
import { toggleDealVote } from '../../../utils/deal-votes'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const result = toggleDealVote(getRawDb(), event, id, body?.vote)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return { success: true, ...result.data }
})
