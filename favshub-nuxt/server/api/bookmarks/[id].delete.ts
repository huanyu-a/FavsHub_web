/**
 * DELETE /api/bookmarks/:id — 删除书签
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)

  // 校验 ID 格式
  const bookmarkId = parseInt(id)
  if (isNaN(bookmarkId)) {
    throw createError({ statusCode: 400, data: { error: '无效的书签 ID' } })
  }

  const db = getRawDb()

  // 验证书签归属
  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(bookmarkId, user.id) as any
  if (!bookmark) {
    throw createError({ statusCode: 404, data: { error: '书签不存在' } })
  }

  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId)

  return { success: true }
})
