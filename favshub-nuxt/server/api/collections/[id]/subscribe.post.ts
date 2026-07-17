/**
 * POST /api/collections/:id/subscribe — 订阅精选集
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const db = getRawDb()

  // 基本频率限制：5 秒内不允许重复订阅/取消订阅操作
  const recentAction = db.prepare(`
    SELECT subscribed_at FROM collection_subscriptions
    WHERE user_id = ? AND collection_id = ?
    UNION ALL
    SELECT subscribed_at FROM collection_subscriptions
    WHERE user_id = ? AND collection_id = ? LIMIT 1
  `).get(user.id, id, user.id, id) as { subscribed_at: number } | undefined

  if (recentAction && (Date.now() - recentAction.subscribed_at) < 5000) {
    throw createError({ statusCode: 429, data: { error: '操作过于频繁，请稍后再试' } })
  }

  // 验证精选集存在且公开
  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as any
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }
  if (!collection.is_public && collection.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '该精选集不公开' } })
  }

  // 检查是否已订阅
  const existing = db.prepare(`
    SELECT 1 FROM collection_subscriptions
    WHERE user_id = ? AND collection_id = ?
  `).get(user.id, id)

  if (existing) {
    return { success: true, message: '已订阅' }
  }

  try {
    const now = Date.now()
    db.prepare(`
      INSERT INTO collection_subscriptions (user_id, collection_id, subscribed_at)
      VALUES (?, ?, ?)
    `).run(user.id, id, now)

    return { success: true, message: '订阅成功' }
  } catch (err: any) {
    console.error('订阅失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '订阅失败' } })
  }
})
