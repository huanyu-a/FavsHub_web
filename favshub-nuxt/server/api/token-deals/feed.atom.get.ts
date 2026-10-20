/**
 * GET /api/token-deals/feed.atom — 白嫖通告变更 Atom Feed
 *
 * 给「Hermes 支持订阅 feed」或任意阅读器用的零代码通道：不用装脚本、不用带游标。
 * 只收 `online / updated / renewed`（下架不进 feed —— 已下架的内容不该继续被分发）。
 * `?token=<sub>` 可套用订阅的过滤条件。
 */
import { getRawDb } from '../../database'
import { getConfig } from '../../utils/config'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import { publicEventViews } from '../../utils/deal-events'
import { filtersMatchEvent, parseFilters, resolveSubscription } from '../../utils/deal-subscriptions'

function xmlEscape(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

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
  // 读侧可见性收敛：通告下架后，它的历史事件不再出现在 feed 里（feed 只分发「现在还能领」的）
  let items = publicEventViews(db, rows.slice().reverse(), { baseUrl })
  items = items.filter(v => !v.deal_redacted)
  if (sub) items = items.filter(v => filtersMatchEvent(filters, { kind: v.kind, deal: v.deal }))

  const updatedAt = items.length ? new Date(items[items.length - 1].created_at).toISOString() : new Date().toISOString()
  const entries = items.map((item) => {
    const link = `${baseUrl}${item.deal.share_path}`
    return `  <entry>
    <title>${xmlEscape(item.text)}</title>
    <id>urn:favshub:deal-event:${item.seq}</id>
    <link rel="alternate" href="${xmlEscape(link)}"/>
    <updated>${new Date(item.created_at).toISOString()}</updated>
    <category term="${xmlEscape(item.kind)}"/>
    <summary type="text">${xmlEscape(item.text)}</summary>
  </entry>`
  }).join('\n')

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>FavsHub 白嫖通告 · 变更</title>
  <subtitle>只推送公开可见通告的上新 / 变更 / 续期</subtitle>
  <id>urn:favshub:deal-events</id>
  <link rel="self" href="${xmlEscape(`${baseUrl}/api/token-deals/feed.atom${q.token ? `?token=${q.token}` : ''}`)}"/>
  <link rel="alternate" href="${xmlEscape(`${baseUrl}/tokens`)}"/>
  <updated>${updatedAt}</updated>
  <author><name>FavsHub</name></author>
${entries}
</feed>
`

  setResponseHeader(event, 'Content-Type', 'application/atom+xml; charset=utf-8')
  // 带 token 的响应体里含订阅凭证（self link 与 feed_url），**绝不能**进共享缓存
  setResponseHeader(event, 'Cache-Control', q.token ? 'private, no-store' : 'public, max-age=300')
  return xml
})
