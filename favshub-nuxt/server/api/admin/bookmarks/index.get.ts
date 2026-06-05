/**
 * GET /api/admin/bookmarks — 获取所有书签（管理员视图）
 * 支持 ?q= 搜索标题和 URL
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const query = getQuery(event)
  const q = typeof query.q === 'string' ? query.q.trim() : ''

  let bookmarks: any[]
  if (q) {
    const like = `%${q}%`
    bookmarks = db.prepare(`
      SELECT b.*, f.name as folder_name, u.username
      FROM bookmarks b
      LEFT JOIN folders f ON b.folder_id = f.id
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.title LIKE ? OR b.url LIKE ?
      ORDER BY b.user_id, b.folder_id, b.sort_order
    `).all(like, like)
  } else {
    bookmarks = db.prepare(`
      SELECT b.*, f.name as folder_name, u.username
      FROM bookmarks b
      LEFT JOIN folders f ON b.folder_id = f.id
      LEFT JOIN users u ON b.user_id = u.id
      ORDER BY b.user_id, b.folder_id, b.sort_order
    `).all()
  }

  return { bookmarks }
})
