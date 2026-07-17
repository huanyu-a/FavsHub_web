/**
 * DELETE /api/collections/:id/subscribe — 取消订阅精选集
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const db = getRawDb()

  try {
    db.prepare(`
      DELETE FROM collection_subscriptions
      WHERE user_id = ? AND collection_id = ?
    `).run(user.id, id)

    return { success: true, message: '取消订阅成功' }
  } catch (err: any) {
    console.error('取消订阅失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '取消订阅失败' } })
  }
})
