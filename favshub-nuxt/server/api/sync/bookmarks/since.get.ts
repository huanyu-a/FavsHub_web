/**
 * GET /api/sync/bookmarks/since — 增量同步（按时间戳获取变更）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler((event) => {
  const authUser = requireAuth(event)
  const query = getQuery(event)
  const timestamp = parseInt(query.timestamp as string) || 0

  const db = getRawDb()
  const userId = authUser.id

  const bookmarks = db.prepare(
    'SELECT * FROM bookmarks WHERE user_id = ? AND COALESCE(updated_at, created_at) > ? ORDER BY created_at'
  ).all(userId, timestamp)

  const folders = db.prepare(
    'SELECT * FROM folders WHERE user_id = ? AND COALESCE(updated_at, created_at) > ? ORDER BY created_at'
  ).all(userId, timestamp)

  return { bookmarks, folders }
})
