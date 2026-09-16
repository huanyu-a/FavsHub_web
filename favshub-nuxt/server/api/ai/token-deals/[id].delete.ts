/**
 * DELETE /api/ai/token-deals/:id — 删除 Token 白嫖通告（delete）
 * Body: { confirm: true, dry_run? }
 *
 * 权限：通告作者或管理员。
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { deleteTokenDeal } from '../../../utils/ai-service'

export default defineAiHandler('delete', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return deleteTokenDeal(getRawDb(), token.user_id, id, body)
})
