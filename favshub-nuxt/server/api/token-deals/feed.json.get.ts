/**
 * GET /api/token-deals/feed.json — JSON Feed 1.1（与 feed.atom 同一份数据）
 */
import { getRawDb } from '../../database'
import { getConfig } from '../../utils/config'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import { publicEventViews } from '../../utils/deal-events'
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

  // 与 changes 对齐的限频：feed 是整包渲染（最多 200 条），不能无限拉
  checkRateLimit(`deal_feed:${getClientIP(event)}`, 60, 60 * 60 * 1000)

  const sub = q.token ? resolveSubscription(db, q.token) : null
  if (q.token && !sub) throw createError({ statusCode: 404, data: { error: '订阅不存在或已退订' } })

  const rows = db.prepare(`
    SELECT * FROM token_deal_events
    WHERE public = 1 AND kind IN ('online', 'updated', 'renewed')
    ORDER BY seq DESC LIMIT ?
  `).all(limit) as any[]

  const filters = sub ? parseFilters(sub.filters) : {}
  // 读侧可见性收敛：通告下架后，它的历史事件不再出现在 feed 里
  let items = publicEventViews(db, rows.slice().reverse(), { baseUrl })
  items = items.filter(v => !v.deal_redacted)
  if (sub) items = items.filter(v => filtersMatchEvent(filters, { kind: v.kind, deal: v.deal }))

  // 带 token 的响应体里含订阅凭证（feed_url），**绝不能**进共享缓存
  setResponseHeader(event, 'Cache-Control', q.token ? 'private, no-store' : 'public, max-age=300')
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
