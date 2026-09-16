/**
 * GET /api/admin/token-deals — 管理端通告列表（仅管理员）
 * Query: status (pending|approved|rejected|all), search, page, limit
 * 同时返回各状态计数，供后台 Tab 徽章展示。
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { escapeLike } from '../../../utils/token-deals'

function parseModels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const query = getQuery(event)
  const status = String(query.status || 'pending')
  const search = String(query.search || '').trim()
  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 20))
  const offset = (page - 1) * limit

  const db = getRawDb()

  let where = '1 = 1'
  const params: any[] = []

  if (status !== 'all') {
    where += ' AND d.status = ?'
    params.push(status)
  }
  if (search) {
    const escaped = escapeLike(search)
    where += ` AND (d.provider LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\')`
    const like = `%${escaped}%`
    params.push(like, like)
  }

  const total = (db.prepare(`SELECT COUNT(*) AS total FROM token_deals d WHERE ${where}`)
    .get(...params) as { total: number }).total

  const rows = db.prepare(`
    SELECT d.*, u.username, u.nickname
    FROM token_deals d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE ${where}
    ORDER BY d.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  const countRows = db.prepare(
    'SELECT status, COUNT(*) AS count FROM token_deals GROUP BY status'
  ).all() as { status: string; count: number }[]

  const counts: Record<string, number> = { pending: 0, approved: 0, rejected: 0, all: 0 }
  for (const row of countRows) {
    counts[row.status] = row.count
    counts.all += row.count
  }

  return {
    deals: rows.map(row => ({
      ...row,
      models: parseModels(row.models),
      is_expired: !!row.expires_at && row.expires_at < Date.now(),
    })),
    counts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
})
