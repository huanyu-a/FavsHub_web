/**
 * PUT /api/ai/prompts/:id — 更新提示词（write）
 * Body: { title?, content?, description?, folder_id?, tags?, is_favorite?, restore?, change_note?, dry_run? }
 *
 * 内容变更时自动创建新版本并自增版本号；restore:true 从回收站恢复。
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { updatePrompt } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return updatePrompt(getRawDb(), token.user_id, id, body)
})
