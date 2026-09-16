/**
 * GET /api/ai/folders — 文件夹列表（read）
 * Query: ?q=
 */
import { getQuery } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { listFolders } from '../../../utils/ai-service'

export default defineAiHandler('read', async (event, token) => {
  return listFolders(getRawDb(), token.user_id, getQuery(event))
})
