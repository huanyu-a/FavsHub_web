/**
 * GET /api/deal-subscriptions/:token — 查自己的订阅（token 即能力）
 */
import { getRawDb } from '../../database'
import { subscriptionView, resolveSubscription } from '../../utils/deal-subscriptions'

export default defineEventHandler((event) => {
  const { token } = getRouterParams(event)
  const db = getRawDb()
  const row = resolveSubscription(db, token)
  if (!row) throw createError({ statusCode: 404, data: { error: '订阅不存在或已退订' } })

  const config = useRuntimeConfig(event)
  const baseUrl = String(config.public?.baseUrl || '').replace(/\/+$/, '')
  return { success: true, subscription: subscriptionView(row, { baseUrl }) }
})
