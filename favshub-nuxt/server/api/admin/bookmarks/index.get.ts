/**
 * GET /api/admin/bookmarks — 管理后台书签列表
 * 管理员：全部书签
 * 普通用户：仅自己的书签
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()
  const query = getQuery(event)

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const q = typeof query.q === 'string' ? query.q.trim() : ''
  const url = typeof query.url === 'string' ? query.url.trim() : ''
  const folderId = query.folder_id ? Number(query.folder_id) : null
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))

  const conditions: string[] = []
  const params: any[] = []

  // 普通用户只看自己的书签
  if (!isAdmin) {
    conditions.push('b.user_id = ?')
    params.push(user.id)
  }

  if (q) {
    conditions.push('b.title LIKE ?')
    params.push(`%${q}%`)
  }
  if (url) {
    conditions.push('b.url LIKE ?')
    params.push(`%${url}%`)
  }
  if (folderId !== null) {
    if (folderId === 0) {
      conditions.push('b.folder_id IS NULL')
    } else {
      conditions.push('b.folder_id = ?')
      params.push(folderId)
    }
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  const countResult = db.prepare(`
    SELECT COUNT(*) as total FROM bookmarks b ${where}
  `).get(...params) as { total: number }
  const total = countResult.total

  const offset = (page - 1) * limit
  const bookmarks = db.prepare(`
    SELECT b.*, f.name as folder_name, u.username
    FROM bookmarks b
    LEFT JOIN folders f ON b.folder_id = f.id
    LEFT JOIN users u ON b.user_id = u.id
    ${where}
    ORDER BY b.folder_id, b.sort_order
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  // 文件夹：所有人都能看到（管理员的文件夹对普通用户只读，前端控制）
  const folders = isAdmin
    ? db.prepare(`
        SELECT f.*, u.username,
          (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
        FROM folders f LEFT JOIN users u ON f.user_id = u.id
        ORDER BY f.name
      `).all()
    : db.prepare(`
        SELECT f.*, u.username,
          (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id AND user_id = ?) as bookmark_count
        FROM folders f LEFT JOIN users u ON f.user_id = u.id
        ORDER BY f.name
      `).all(user.id)

  return { bookmarks, folders, total, page, limit, isAdmin }
})
