/**
 * GET /api/admin/folders — 获取所有文件夹（管理员视图）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const folders = db.prepare(`
    SELECT f.*, u.username,
      (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
    FROM folders f
    LEFT JOIN users u ON f.user_id = u.id
    ORDER BY f.user_id, f.parent_id, f.sort_order
  `).all()

  return { folders }
})
