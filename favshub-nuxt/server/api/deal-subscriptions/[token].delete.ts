/**
 * DELETE /api/deal-subscriptions/:token — 退订（立即生效）
 *
 * 置 `revoked` 并清空过滤条件：之后该 token 再访问任何接口都是 404，
 * 站点也不再为它记账（`revoked` 行只留给后台统计）。
 */
import { getRawDb } from '../../database'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import { resolveSubscription } from '../../utils/deal-subscriptions'

export default defineEventHandler((event) => {
  checkRateLimit(`deal_sub_rw:${getClientIP(event)}`, 60, 60 * 60 * 1000)

  const { token } = getRouterParams(event)
  const db = getRawDb()
  const row = resolveSubscription(db, token)
  if (!row) throw createError({ statusCode: 404, data: { error: '订阅不存在或已退订' } })

  db.prepare(
    "UPDATE deal_subscriptions SET status = 'revoked', filters = '{}', updated_at = ? WHERE id = ?"
  ).run(Date.now(), row.id)

  return { success: true, message: '已退订：请同时删除你机器上的轮询任务' }
})
