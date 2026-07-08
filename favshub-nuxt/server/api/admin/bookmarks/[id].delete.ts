/**
 * DELETE /api/admin/bookmarks/:id — 删除书签
 * 管理员：可删除任意书签
 * 普通用户：仅可删除自己的书签
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  try {
    const authRole = getAuthRole(event)
    if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
    const { user: auth, isAdmin } = authRole
    const db = getRawDb()

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
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, data: { error: '删除书签失败' } })
  }
})
