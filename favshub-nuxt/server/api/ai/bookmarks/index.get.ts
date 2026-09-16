/**
 * GET /api/ai/bookmarks — 书签列表（read）
 * Query: ?q=&folder_id=&label=&limit=&page=
 */
import { getQuery } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { listBookmarks } from '../../../utils/ai-service'

export default defineAiHandler('read', async (event, token) => {
  return listBookmarks(getRawDb(), token.user_id, getQuery(event))
})
