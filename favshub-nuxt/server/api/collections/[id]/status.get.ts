/**
 * GET /api/collections/:id/status — 用户导入状态
 * 返回：is_subscribed, imported_count, total_count, new_count（未导入的新书签数）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const db = getRawDb()

  // 验证精选集存在且用户有权查看（公开 或 自己创建的）
  const collection = db.prepare('SELECT id, user_id, is_public FROM collections WHERE id = ?').get(id) as any
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }
  if (!collection.is_public && collection.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权查看此精选集' } })
  }

  // 查询订阅状态
  const isSubscribed = db.prepare(`
    SELECT 1 FROM collection_subscriptions
    WHERE user_id = ? AND collection_id = ?
  `).get(user.id, id)

  // 查询导入数量
  const importedCount = db.prepare(`
    SELECT COUNT(*) as count FROM collection_imports
    WHERE user_id = ? AND collection_id = ?
  `).get(user.id, id) as { count: number }

  // 查询总书签数
  const totalCount = db.prepare(`
    SELECT COUNT(*) as count FROM collection_bookmarks
    WHERE collection_id = ?
  `).get(id) as { count: number }

  // 新书签数 = 总数 - 已导入数
  const newCount = Math.max(0, totalCount.count - importedCount.count)

  return {
    is_subscribed: !!isSubscribed,
    imported_count: importedCount.count,
    total_count: totalCount.count,
    new_count: newCount
  }
})
