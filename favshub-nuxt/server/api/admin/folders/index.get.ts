/**
 * GET /api/admin/folders — 获取所有文件夹（管理员视图）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const db = getRawDb()

  const folders = db.prepare(`
    SELECT f.*, u.username,
      pf.name as parent_name,
      (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
    FROM folders f
    LEFT JOIN users u ON f.user_id = u.id
    LEFT JOIN folders pf ON f.parent_id = pf.id
    ORDER BY f.user_id, f.parent_id, f.sort_order
  `).all()

  return { folders }
})
