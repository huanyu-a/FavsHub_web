/**
 * DELETE /api/admin/bookmarks/:id — 删除书签（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const bookmarkId = parseInt(id)
  if (isNaN(bookmarkId)) {
    throw createError({ statusCode: 400, data: { error: '无效的书签 ID' } })
  }

  const bookmark = db.prepare('SELECT id FROM bookmarks WHERE id = ?').get(bookmarkId) as any
  if (!bookmark) {
    throw createError({ statusCode: 404, data: { error: '书签不存在' } })
  }

  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId)

  return { success: true, message: '已删除书签' }
})
