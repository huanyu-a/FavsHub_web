/**
 * GET /api/ai/tags — 标签列表（read，含使用计数）
 */
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { listTags } from '../../../utils/ai-service'

export default defineAiHandler('read', async (_event, token) => {
  return listTags(getRawDb(), token.user_id)
})
