/**
 * GET /api/token-deals — Token 白嫖通告列表
 * Query: page, limit, search, region, quality, source_tag, sort (latest|hot|rating|expiring), mine
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'
import { escapeLike } from '../../utils/token-deals'

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
  const user = optionalAuth(event)
  const query = getQuery(event)

  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 24))
  const offset = (page - 1) * limit
  const search = String(query.search || '').trim()
  const region = String(query.region || '').trim()
  const quality = String(query.quality || '').trim()
  const sourceTag = String(query.source_tag || '').trim()
  const sort = String(query.sort || 'latest')
  const mine = query.mine === '1' || query.mine === 'true'

  const db = getRawDb()

  let whereClause: string
  const params: any[] = []

  if (mine) {
    if (!user) {
      throw createError({ statusCode: 401, data: { error: '未登录' } })
    }
    whereClause = 'd.user_id = ?'
    params.push(user.id)
  } else {
    // 公开列表只展示审核通过的通告
    whereClause = "d.status = 'approved'"
  }

  if (search) {
    const escaped = escapeLike(search)
    whereClause += ` AND (d.provider LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\'`
      + ` OR d.quota LIKE ? ESCAPE '\\' OR d.note LIKE ? ESCAPE '\\' OR d.models LIKE ? ESCAPE '\\')`
    const like = `%${escaped}%`
    params.push(like, like, like, like, like)
  }
  if (region) {
    whereClause += ' AND d.region = ?'
    params.push(region)
  }
  if (quality) {
    whereClause += ' AND d.quality = ?'
    params.push(quality)
  }
  if (sourceTag) {
    whereClause += ' AND d.source_tag = ?'
    params.push(sourceTag)
  }

  let orderClause = 'd.pinned DESC, d.created_at DESC'
  if (sort === 'hot') {
    orderClause = 'd.pinned DESC, (d.vote_up - d.vote_down) DESC, d.vote_up DESC, d.created_at DESC'
  } else if (sort === 'rating') {
    orderClause = 'd.pinned DESC, (CASE WHEN d.rating_count > 0 THEN CAST(d.rating_sum AS REAL) / d.rating_count ELSE 0 END) DESC, d.rating_count DESC'
  } else if (sort === 'expiring') {
    // 永久有效（expires_at 为空）排在最后，其余按到期时间升序
    orderClause = 'd.pinned DESC, (d.expires_at IS NULL) ASC, d.expires_at ASC'
  }

  const total = (db.prepare(`SELECT COUNT(*) AS total FROM token_deals d WHERE ${whereClause}`)
    .get(...params) as { total: number }).total

  const rows = db.prepare(`
    SELECT d.*, u.username, u.nickname
    FROM token_deals d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  const deals = rows.map(row => ({
    ...row,
    models: parseModels(row.models),
    is_expired: !!row.expires_at && row.expires_at < Date.now(),
  }))

  return {
    deals,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
})
