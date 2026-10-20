/**
 * PATCH /api/deal-subscriptions/:token — 改自己的订阅
 *
 * 只允许改 `label / filters / status(active|paused)`；**不允许改投递目标**
 * （本方案里站点不投递，目标在游客自己的 Hermes 里），也**不允许**借此读任何通告数据。
 * 退订走 DELETE。
 *
 * Body: { label?, filters?, status?: 'active'|'paused' }
 */
import { getRawDb } from '../../database'
import { normalizeFilters, resolveSubscription, subscriptionView } from '../../utils/deal-subscriptions'

export default defineEventHandler(async (event) => {
  const { token } = getRouterParams(event)
  const db = getRawDb()
  const row = resolveSubscription(db, token)
  if (!row) throw createError({ statusCode: 404, data: { error: '订阅不存在或已退订' } })

  const body = await readBody(event).catch(() => ({} as any))
  const sets: string[] = []
  const params: any[] = []

  if (body?.label !== undefined) {
    sets.push('label = ?')
    params.push(String(body.label).trim().slice(0, 40))
  }
  if (body?.filters !== undefined) {
    sets.push('filters = ?')
    params.push(JSON.stringify(normalizeFilters(body.filters)))
  }
  if (body?.status !== undefined) {
    const next = String(body.status)
    if (next !== 'active' && next !== 'paused') {
      throw createError({ statusCode: 400, data: { error: 'status 只能是 active 或 paused（退订请用 DELETE）' } })
    }
    sets.push('status = ?')
    params.push(next)
  }
  if (!sets.length) {
    throw createError({ statusCode: 400, data: { error: '没有可更新的字段（label / filters / status）' } })
  }

  sets.push('updated_at = ?')
  params.push(Date.now(), row.id)
  db.prepare(`UPDATE deal_subscriptions SET ${sets.join(', ')} WHERE id = ?`).run(...params)

  const fresh = db.prepare('SELECT * FROM deal_subscriptions WHERE id = ?').get(row.id) as any
  const config = useRuntimeConfig(event)
  const baseUrl = String(config.public?.baseUrl || '').replace(/\/+$/, '')
  return { success: true, subscription: subscriptionView(fresh, { baseUrl }) }
})
