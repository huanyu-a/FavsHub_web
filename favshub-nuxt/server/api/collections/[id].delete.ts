/**
 * DELETE /api/collections/:id — 删除精选集
 * 级联删除 categories, bookmarks, subscriptions, imports
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const db = getRawDb()

  // 验证归属
  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as any
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }
  if (collection.user_id !== user.id) {
    // 管理员可删除任意精选集
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as any
    if (!dbUser?.is_admin) {
      throw createError({ statusCode: 403, data: { error: '无权删除此精选集' } })
    }
  }

  try {
    // FIX: MAJOR #11 - 显式级联删除，不依赖外键约束（防止约束未启用时残留数据）
    db.transaction(() => {
      db.prepare('DELETE FROM collection_imports WHERE collection_id = ?').run(id)
      db.prepare('DELETE FROM collection_subscriptions WHERE collection_id = ?').run(id)
      db.prepare('DELETE FROM collection_bookmarks WHERE collection_id = ?').run(id)
      db.prepare('DELETE FROM collection_categories WHERE collection_id = ?').run(id)
      db.prepare('DELETE FROM collections WHERE id = ?').run(id)
    })()
    return { success: true }
  } catch (err: any) {
    console.error('删除精选集失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '删除精选集失败' } })
  }
})
