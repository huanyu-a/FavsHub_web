/**
 * GET /api/admin/users/:id/bookmarks — 查看指定用户的书签
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const userId = parseInt(id)
  if (isNaN(userId)) {
    throw createError({ statusCode: 400, data: { error: '无效的用户 ID' } })
  }

  const bookmarks = db.prepare(`
    SELECT b.*, f.name as folder_name FROM bookmarks b
    LEFT JOIN folders f ON b.folder_id = f.id
    WHERE b.user_id = ? ORDER BY b.folder_id, b.sort_order
  `).all(userId)

  return { bookmarks }
})
