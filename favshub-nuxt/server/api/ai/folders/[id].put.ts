/**
 * PUT /api/ai/folders/:id — 更新文件夹（write）
 * Body: { name?, parent_id?, icon?, sort_order?, login_required?, dry_run? }
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { updateFolder } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return updateFolder(getRawDb(), token.user_id, id, body)
})
