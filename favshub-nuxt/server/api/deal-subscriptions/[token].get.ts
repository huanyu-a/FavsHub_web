/**
 * GET /api/deal-subscriptions/:token — 查自己的订阅（token 即能力）
 */
import { getRawDb } from '../../database'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import { subscriptionView, resolveSubscription } from '../../utils/deal-subscriptions'

export default defineEventHandler((event) => {
  // 60 次/小时：足够脚本自检，又挡住拿 token 当探针刷 404 的行为
  checkRateLimit(`deal_sub_rw:${getClientIP(event)}`, 60, 60 * 60 * 1000)

  const { token } = getRouterParams(event)
  const db = getRawDb()
  const row = resolveSubscription(db, token)
  if (!row) throw createError({ statusCode: 404, data: { error: '订阅不存在或已退订' } })

  const config = useRuntimeConfig(event)
  const baseUrl = String(config.public?.baseUrl || '').replace(/\/+$/, '')
  return { success: true, subscription: subscriptionView(row, { baseUrl }) }
})
