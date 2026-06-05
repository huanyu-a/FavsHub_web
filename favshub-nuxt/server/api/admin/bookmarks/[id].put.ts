/**
 * PUT /api/admin/bookmarks/:id — 更新书签（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

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

  const body = await readBody(event)
  const { title, url, folder_id, icon, login_required } = body

  const now = Date.now()
  if (title !== undefined) {
    db.prepare('UPDATE bookmarks SET title = ?, updated_at = ? WHERE id = ?').run(title, now, bookmarkId)
  }
  if (url !== undefined) {
    db.prepare('UPDATE bookmarks SET url = ?, updated_at = ? WHERE id = ?').run(url, now, bookmarkId)
  }
  if (folder_id !== undefined) {
    db.prepare('UPDATE bookmarks SET folder_id = ?, updated_at = ? WHERE id = ?').run(folder_id !== 0 ? folder_id : null, now, bookmarkId)
  }
  if (icon !== undefined) {
    db.prepare('UPDATE bookmarks SET icon = ?, updated_at = ? WHERE id = ?').run(icon, now, bookmarkId)
  }
  if (login_required !== undefined) {
    db.prepare('UPDATE bookmarks SET login_required = ?, updated_at = ? WHERE id = ?').run(login_required ? 1 : 0, now, bookmarkId)
  }

  const updated = db.prepare(`
    SELECT b.*, f.name as folder_name, u.username 
    FROM bookmarks b 
    LEFT JOIN folders f ON b.folder_id = f.id 
    LEFT JOIN users u ON b.user_id = u.id 
    WHERE b.id = ?
  `).get(bookmarkId)

  return { bookmark: updated }
})
