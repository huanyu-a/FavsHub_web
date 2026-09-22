/**
 * DELETE /api/ai/token-deal-edits/:id — 撤回自己提交的修改建议（write）
 *
 * 仅建议人可撤回自己的（管理员可撤回任意待审建议）；仅 `pending` 状态可撤回。
 *
 * 注意 scope 为 write 而非 delete：撤回提案不是删除数据资源，
 * 与 Web 端 `DELETE /api/token-deal-edits/:id` 的权限口径保持一致（登录即可，无需管理员）。
 */
import { getRouterParams } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { withdrawTokenDealEdit } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const { id } = getRouterParams(event)
  return withdrawTokenDealEdit(getRawDb(), token.user_id, id)
})
