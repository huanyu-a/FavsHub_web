/**
 * DELETE /api/admin/bookmarks/:id — 删除书签
 * 管理员：可删除任意书签
 * 普通用户：仅可删除自己的书签
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const { id } = getRouterParams(event)
  const bookmarkId = parseInt(id)
  if (isNaN(bookmarkId)) {
    throw createError({ statusCode: 400, data: { error: '无效的书签 ID' } })
  }

  const bookmark = db.prepare('SELECT id, user_id FROM bookmarks WHERE id = ?').get(bookmarkId) as any
  if (!bookmark) {
    throw createError({ statusCode: 404, data: { error: '书签不存在' } })
  }

  if (!isAdmin && bookmark.user_id !== auth.id) {
    throw createError({ statusCode: 403, data: { error: '无权限删除此书签' } })
  }

  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId)

  return { success: true, message: '已删除书签' }
})
