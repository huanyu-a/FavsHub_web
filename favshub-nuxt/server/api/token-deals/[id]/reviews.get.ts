/**
 * GET /api/token-deals/:id/reviews — 评测列表
 * Query: page, limit
 * 公开可读，附带 1-5 星分布便于前端渲染评分条。
 */
import { getRawDb } from '../../../database'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const query = getQuery(event)

  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(query.limit as string) || 10))
  const offset = (page - 1) * limit

  const db = getRawDb()
  const deal = db.prepare('SELECT id FROM token_deals WHERE id = ?').get(id)
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  const total = (db.prepare('SELECT COUNT(*) AS total FROM token_deal_reviews WHERE deal_id = ?')
    .get(id) as { total: number }).total

  const reviews = db.prepare(`
    SELECT r.id, r.rating, r.content, r.created_at, r.updated_at,
           COALESCE(NULLIF(u.nickname, ''), u.username, '匿名') AS author
    FROM token_deal_reviews r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.deal_id = ?
    ORDER BY r.updated_at DESC, r.id DESC
    LIMIT ? OFFSET ?
  `).all(id, limit, offset)

  const rows = db.prepare(
    'SELECT rating, COUNT(*) AS count FROM token_deal_reviews WHERE deal_id = ? GROUP BY rating'
  ).all(id) as { rating: number; count: number }[]

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const row of rows) {
    if (row.rating >= 1 && row.rating <= 5) distribution[row.rating] = row.count
  }

  return {
    reviews,
    distribution,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
})
