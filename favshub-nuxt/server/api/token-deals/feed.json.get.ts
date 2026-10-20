/**
 * GET /api/token-deals/feed.json — JSON Feed 1.1（与 feed.atom 同一份数据）
 */
import { getRawDb } from '../../database'
import { getConfig } from '../../utils/config'
import { toEventView } from '../../utils/deal-events'
import { filtersMatchEvent, parseFilters, resolveSubscription } from '../../utils/deal-subscriptions'

export default defineEventHandler((event) => {
  if (getConfig('deal_feed_enabled') === 'false') {
    throw createError({ statusCode: 404, data: { error: 'Feed 未开放' } })
  }
  const q = getQuery(event)
  const db = getRawDb()
  const config = useRuntimeConfig(event)
  const baseUrl = String(config.public?.baseUrl || '').replace(/\/+$/, '')
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50))

  const sub = q.token ? resolveSubscription(db, q.token) : null
  if (q.token && !sub) throw createError({ statusCode: 404, data: { error: '订阅不存在或已退订' } })

  const rows = db.prepare(`
    SELECT * FROM token_deal_events
    WHERE public = 1 AND kind IN ('online', 'updated', 'renewed')
    ORDER BY seq DESC LIMIT ?
  `).all(limit) as any[]

  const filters = sub ? parseFilters(sub.filters) : {}
  let items = rows.slice().reverse().map(row => toEventView(row, { baseUrl }))
  if (sub) items = items.filter(v => filtersMatchEvent(filters, { kind: v.kind, deal: v.deal }))

  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'FavsHub 白嫖通告 · 变更',
    home_page_url: `${baseUrl}/tokens`,
    feed_url: `${baseUrl}/api/token-deals/feed.json${q.token ? `?token=${q.token}` : ''}`,
    description: '只推送公开可见通告的上新 / 变更 / 续期',
    items: items.map(item => ({
      id: `deal-event-${item.seq}`,
      url: `${baseUrl}${item.deal.share_path}`,
      title: item.text,
      content_text: item.text,
      date_published: new Date(item.created_at).toISOString(),
      tags: [item.kind],
    })),
  }
})
