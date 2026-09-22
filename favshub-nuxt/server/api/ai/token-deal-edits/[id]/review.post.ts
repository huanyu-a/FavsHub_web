/**
 * POST /api/ai/token-deal-edits/:id/review — 审核通告修改建议（write）
 *
 * Body: { action: 'approve' | 'reject', reason?, dry_run? }
 *
 * 权限：**通告作者** 或 **管理员**（管理员可审核所有用户的建议）。他人一律 404。
 * approve 会把建议内容写入通告（以通告当前内容为底合并）；
 * reject 需携带 reason 说明理由。
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../../database'
import { defineAiHandler } from '../../../../utils/ai-auth'
import { reviewTokenDealEdit } from '../../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return reviewTokenDealEdit(getRawDb(), token.user_id, id, body)
})
