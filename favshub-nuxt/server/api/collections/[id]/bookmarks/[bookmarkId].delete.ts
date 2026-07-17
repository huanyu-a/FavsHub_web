/**
 * DELETE /api/collections/:id/bookmarks/:bookmarkId — 删除精选集中的单个书签
 */
import { getRawDb } from '../../../../database'
import { requireAuth } from '../../../../utils/auth'
import { getRouterParam } from 'h3'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const id = getRouterParam(event, 'id')
  const bookmarkId = getRouterParam(event, 'bookmarkId')
  if (!id || !bookmarkId) {
    throw createError({ statusCode: 400, data: { error: '缺少参数' } })
  }

  const db = getRawDb()

  // 校验精选集存在 & 权限
  const collection = db.prepare('SELECT id, user_id FROM collections WHERE id = ?').get(id)
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }
  if (collection.user_id !== user.id) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id)
    if (!dbUser?.is_admin) {
      throw createError({ statusCode: 403, data: { error: '无权修改此精选集' } })
    }
  }

  // 校验书签存在
  const bookmark = db.prepare('SELECT id FROM collection_bookmarks WHERE id = ? AND collection_id = ?').get(bookmarkId, id)
  if (!bookmark) {
    throw createError({ statusCode: 404, data: { error: '书签不存在' } })
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM collection_bookmarks WHERE id = ? AND collection_id = ?').run(bookmarkId, id)
    db.prepare('UPDATE collections SET bookmark_count = MAX(0, bookmark_count - 1), updated_at = ? WHERE id = ?').run(Date.now(), id)
  })

  tx()

  return { success: true }
})
