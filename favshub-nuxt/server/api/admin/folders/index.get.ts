/**
 * GET /api/admin/folders — 书签文件夹列表
 * 所有人可见（管理员的文件夹对普通用户只读，前端控制）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const folders = isAdmin
    ? db.prepare(`
        SELECT f.*, u.username,
          pf.name as parent_name,
          (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
        FROM folders f
        LEFT JOIN users u ON f.user_id = u.id
        LEFT JOIN folders pf ON f.parent_id = pf.id
        ORDER BY f.user_id, f.parent_id, f.sort_order
      `).all()
    : db.prepare(`
        SELECT f.*, u.username,
          pf.name as parent_name,
          (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id AND user_id = ?) as bookmark_count
        FROM folders f
        LEFT JOIN users u ON f.user_id = u.id
        LEFT JOIN folders pf ON f.parent_id = pf.id
        ORDER BY f.user_id, f.parent_id, f.sort_order
      `).all(user.id)

  return { folders, isAdmin }
})
