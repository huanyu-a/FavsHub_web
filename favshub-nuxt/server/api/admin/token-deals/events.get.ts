/**
 * GET /api/admin/token-deals/events — 最近事件流（仅管理员，只读）
 *
 * 排查用：某条通告「为什么没推给订阅者」时，先看这里有没有对应事件。
 * 没有事件 = 那次变化不满足公开边界（未审核 / 未公开 / 无实质差异），而不是推送坏了。
 *
 * Query: ?limit=50&kind=online|offline|updated|renewed|pinned
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { toEventView } from '../../../utils/deal-events'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const q = getQuery(event)
  const db = getRawDb()
  const config = useRuntimeConfig(event)
  const baseUrl = String(config.public?.baseUrl || '').replace(/\/+$/, '')

  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50))
  const kind = String(q.kind || '').trim()
  const kindSql = kind ? ' AND kind = ?' : ''
  const rows = db.prepare(
    `SELECT * FROM token_deal_events WHERE public = 1${kindSql} ORDER BY seq DESC LIMIT ?`
  ).all(...(kind ? [kind, limit] : [limit])) as any[]

  const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM token_deal_events').get() as any
  return {
    success: true,
    max_seq: Number(maxSeq?.seq || 0),
    items: rows.map(row => toEventView(row, { baseUrl })),
  }
})
