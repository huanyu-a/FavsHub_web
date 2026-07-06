/**
 * GET /api/admin/folders — 书签文件夹列表
 * 管理员：返回全部文件夹
 * 普通用户：自己的 + 管理员的公开文件夹（login_required=0）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  let folders: any[]
  if (isAdmin) {
    folders = db.prepare(`
      SELECT f.*, u.username,
        pf.name as parent_name,
        (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
      FROM folders f
      LEFT JOIN users u ON f.user_id = u.id
      LEFT JOIN folders pf ON f.parent_id = pf.id
      ORDER BY f.user_id, f.parent_id, f.sort_order
    `).all()
  } else {
    folders = db.prepare(`
      SELECT f.*, u.username,
        pf.name as parent_name,
        (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
      FROM folders f
      LEFT JOIN users u ON f.user_id = u.id
      LEFT JOIN folders pf ON f.parent_id = pf.id
      WHERE f.user_id = ? OR (f.login_required = 0)
      ORDER BY f.parent_id, f.sort_order
    `).all(auth.id)
  }

  return { folders, isAdmin }
})
