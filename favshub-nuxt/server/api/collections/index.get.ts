/**
 * GET /api/collections — 精选集列表
 * Query: page, limit, search, sort (hot|latest), is_official, subscribed
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

/**
 * FIX: MAJOR #7 - 转义 LIKE 通配符，防止注入攻击
 */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const query = getQuery(event)

  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 20))
  const offset = (page - 1) * limit
  const search = query.search as string || ''
  const sort = query.sort as string || 'latest'
  const isOfficial = query.is_official === '1' || query.is_official === 'true'
  const subscribed = query.subscribed === '1' || query.subscribed === 'true'

  const db = getRawDb()

  // 构建查询条件
  let whereClause = 'c.is_public = 1'
  const params: any[] = []

  // FIX: MAJOR #7 - 转义搜索关键词防止通配符注入
  if (search) {
    const escaped = escapeLike(search)
    whereClause += ` AND (c.name LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')`
    params.push(`%${escaped}%`, `%${escaped}%`)
  }

  if (isOfficial) {
    whereClause += ' AND c.is_official = 1'
  }

  // 如果是已订阅筛选（需要登录）
  if (subscribed && user) {
    whereClause += ' AND EXISTS (SELECT 1 FROM collection_subscriptions WHERE user_id = ? AND collection_id = c.id)'
    params.push(user.id)
  }

  // 排序
  let orderClause = 'c.created_at DESC'
  if (sort === 'hot') {
    orderClause = 'c.bookmark_count DESC, c.created_at DESC'
  }

  // 查询总数
  const totalSql = `SELECT COUNT(*) as total FROM collections c WHERE ${whereClause}`
  const totalResult = db.prepare(totalSql).get(...params) as { total: number }
  const total = totalResult.total

  // 查询列表
  const sql = `
    SELECT c.*, u.username, u.nickname,
      (SELECT COUNT(*) FROM collection_bookmarks WHERE collection_id = c.id) as bookmark_count
      ${user ? `, EXISTS (SELECT 1 FROM collection_subscriptions WHERE user_id = ? AND collection_id = c.id) as is_subscribed` : ''}
    FROM collections c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ? OFFSET ?
  `

  const queryParams = user ? [user.id, ...params, limit, offset] : [...params, limit, offset]
  const collections = db.prepare(sql).all(...queryParams)

  return {
    collections,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  }
})
