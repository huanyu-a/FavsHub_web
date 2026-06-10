/**
 * GET /api/admin/bookmarks — 获取所有书签（管理员视图）
 * 支持 ?q= 搜索标题, ?url= 搜索URL, ?folder_id= 按文件夹筛选
 * 支持 ?page=&limit= 分页
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
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

  // 获取总数
  const countResult = db.prepare(`
    SELECT COUNT(*) as total
    FROM bookmarks b
    ${where}
  `).get(...params) as { total: number }

  const total = countResult.total

  // 获取分页数据
  const offset = (page - 1) * limit
  let bookmarks: any[] = db.prepare(`
    SELECT b.*, f.name as folder_name, u.username
    FROM bookmarks b
    LEFT JOIN folders f ON b.folder_id = f.id
    LEFT JOIN users u ON b.user_id = u.id
    ${where}
    ORDER BY b.user_id, b.folder_id, b.sort_order
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  return { bookmarks, total, page, limit }
})
