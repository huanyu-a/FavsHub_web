/**
 * DELETE /api/admin/collections/:id — 管理员删除精选集
 * 管理员可删除任意精选集，级联删除 categories, bookmarks, subscriptions, imports
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const { id } = getRouterParams(event)
  const db = getRawDb()

  // 验证精选集存在
  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as any
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }

  try {
    // 显式级联删除，不依赖外键约束
    db.transaction(() => {
      db.prepare('DELETE FROM collection_imports WHERE collection_id = ?').run(id)
      db.prepare('DELETE FROM collection_subscriptions WHERE collection_id = ?').run(id)
      db.prepare('DELETE FROM collection_bookmarks WHERE collection_id = ?').run(id)
      db.prepare('DELETE FROM collection_categories WHERE collection_id = ?').run(id)
      db.prepare('DELETE FROM collections WHERE id = ?').run(id)
    })()

    return { success: true }
  } catch (err: any) {
    console.error('[Admin] 删除精选集失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '删除精选集失败' } })
  }
})
