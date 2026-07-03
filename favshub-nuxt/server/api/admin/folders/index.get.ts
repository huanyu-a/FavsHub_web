/**
 * GET /api/admin/folders — 书签文件夹列表（仅管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
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

  return { folders, isAdmin: true }
})
