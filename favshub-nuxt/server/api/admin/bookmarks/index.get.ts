/**
 * GET /api/admin/bookmarks — 管理后台书签列表（管理员专用）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const db = getRawDb()
  const query = getQuery(event)

  const q = typeof query.q === 'string' ? query.q.trim() : ''
  const url = typeof query.url === 'string' ? query.url.trim() : ''
  const folderId = query.folder_id ? Number(query.folder_id) : null
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))

  const conditions: string[] = []
  const params: any[] = []

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

  // 管理员可查看所有文件夹
  const folders = db.prepare(`
    SELECT f.*, u.username,
      (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
    FROM folders f LEFT JOIN users u ON f.user_id = u.id
    ORDER BY f.name
  `).all()

  return { bookmarks, folders, total, page, limit, isAdmin: true }
})
