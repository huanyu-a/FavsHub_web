/**
 * GET /api/admin/token-deals/subscriptions — 订阅账本（仅管理员，只读）
 *
 * 站点不投递，所以这里没有「送达率」；能看的是「谁在订阅、关心什么、最近有没有来拉」。
 * 不返回 `sub_token`（一律脱敏），也不返回任何游客身份信息（本来就不采集）。
 *
 * Query: ?status=active|paused|revoked|all&search=&page=1&limit=20
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { maskSubToken, parseFilters } from '../../../utils/deal-subscriptions'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const q = getQuery(event)
  const db = getRawDb()

  const page = Math.max(1, Number(q.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20))
  const status = String(q.status || 'all')
  const search = String(q.search || '').trim()

  const where: string[] = []
  const params: any[] = []
  if (status !== 'all') {
    where.push('status = ?')
    params.push(status)
  }
  if (search) {
    where.push('(label LIKE ? OR id LIKE ?)')
    params.push(`%${search}%`, `%${search}%`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM deal_subscriptions ${whereSql}`).get(...params) as any
  const rows = db.prepare(
    `SELECT * FROM deal_subscriptions ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit) as any[]

  const counts = { active: 0, paused: 0, revoked: 0 } as Record<string, number>
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM deal_subscriptions GROUP BY status').all() as any[]) {
    counts[row.status] = Number(row.n)
  }

  const now = Date.now()
  const items = rows.map(row => {
    const filters = parseFilters(row.filters)
    const summary: string[] = []
    if (filters.kinds?.length) summary.push(`类型 ${filters.kinds.join('/')}`)
    if (filters.providers?.length) summary.push(`服务商 ${filters.providers.join('/')}`)
    if (filters.regions?.length) summary.push(`地区 ${filters.regions.join('/')}`)
    if (filters.keywords?.length) summary.push(`关键词 ${filters.keywords.join('/')}`)
    return {
      id: row.id,
      token_masked: maskSubToken(row.sub_token),
      label: row.label,
      filters,
      filters_summary: summary.join('；') || '全部通告',
      status: row.status,
      cursor: row.cursor,
      pull_count: row.pull_count,
      last_pull_at: row.last_pull_at,
      // 静默判定：超过 3 天没来拉，说明游客的 cron 大概停了
      stale: row.status === 'active' && (!row.last_pull_at || now - row.last_pull_at > 3 * 86400000),
      created_at: row.created_at,
    }
  })

  return { success: true, total: Number(totalRow?.n || 0), page, limit, counts, items }
})
