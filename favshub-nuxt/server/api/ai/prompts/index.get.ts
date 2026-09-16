/**
 * GET /api/ai/prompts — 提示词列表（read）
 * Query: ?q=&folder_id=&favorite=&limit=&page=
 */
import { getQuery } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { listPrompts } from '../../../utils/ai-service'

export default defineAiHandler('read', async (event, token) => {
  return listPrompts(getRawDb(), token.user_id, getQuery(event))
})
