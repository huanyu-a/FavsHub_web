/**
 * DELETE /api/ai/prompts/:id — 删除提示词（delete）
 * Body: { confirm: true, permanent?: boolean, dry_run? }
 *
 * 默认软删除（进入回收站，可用 PUT restore:true 恢复）；permanent:true 才物理删除。
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { deletePrompt } from '../../../utils/ai-service'

export default defineAiHandler('delete', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return deletePrompt(getRawDb(), token.user_id, id, body)
})
