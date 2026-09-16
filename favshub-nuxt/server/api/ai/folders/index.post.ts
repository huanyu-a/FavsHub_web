/**
 * POST /api/ai/folders — 创建文件夹（write）
 * Body: { name, parent_id?, icon?, login_required?, dry_run? }
 */
import { readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { createFolder } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const body = await readBody(event).catch(() => ({}))
  return createFolder(getRawDb(), token.user_id, body)
})
