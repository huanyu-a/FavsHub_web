/**
 * GET /api/admin/bookmarks — 管理后台书签列表
 * 所有用户仅返回自己的书签
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { getQuery, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()
  const query = getQuery(event)

  const q = typeof query.q === 'string' ? query.q.trim() : ''
  const url = typeof query.url === 'string' ? query.url.trim() : ''
  const folderId = query.folder_id ? Number(query.folder_id) : null
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))

  const conditions: string[] = ['b.user_id = ?']
  const params: any[] = [auth.id]

  const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&')
  if (q) {
    conditions.push(`b.title LIKE ? ESCAPE '\\'`)
    params.push(`%${escapeLike(q)}%`)
  }
  if (url) {
    conditions.push(`b.url LIKE ? ESCAPE '\\'`)
    params.push(`%${escapeLike(url)}%`)
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

  // 文件夹：仅自己
  const folders = db.prepare(`
    SELECT f.*, u.username,
      (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
    FROM folders f LEFT JOIN users u ON f.user_id = u.id
    WHERE f.user_id = ?
    ORDER BY f.name
  `).all(auth.id)

  return { bookmarks, folders, total, page, limit, isAdmin: false }
})
