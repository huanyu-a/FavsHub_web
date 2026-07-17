/**
 * GET /api/sync/bookmarks/full — 获取服务端完整书签状态
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler((event) => {
  const authUser = requireAuth(event)
  const db = getRawDb()
  const userId = authUser.id

  const bookmarks = db.prepare(
    "SELECT * FROM bookmarks WHERE user_id = ? AND label != '' ORDER BY sort_order, created_at"
  ).all(userId)

  const folders = db.prepare(
    'SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order, created_at'
  ).all(userId)

  return { bookmarks, folders, timestamp: Date.now() }
})
