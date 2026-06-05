/**
 * GET /api/admin/bookmarks — 获取所有书签（管理员视图）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const bookmarks = db.prepare(`
    SELECT b.*, f.name as folder_name, u.username
    FROM bookmarks b
    LEFT JOIN folders f ON b.folder_id = f.id
    LEFT JOIN users u ON b.user_id = u.id
    ORDER BY b.user_id, b.folder_id, b.sort_order
  `).all()

  return { bookmarks }
})
