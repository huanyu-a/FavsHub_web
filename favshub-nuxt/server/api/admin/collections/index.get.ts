/**
 * GET /api/admin/collections — 管理后台列表
 * 需要管理员权限，返回所有精选集（包括私有的）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const query = getQuery(event)

  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 50))
  const offset = (page - 1) * limit
  const search = query.search as string || ''
  const type = query.type as string || ''

  const db = getRawDb()

  // 转义 LIKE 通配符
  function escapeLike(str: string): string {
    return str.replace(/[%_\\]/g, '\\$&')
  }

  // 构建查询条件
  let whereClause = '1=1'
  const params: any[] = []

  if (search) {
    const escaped = escapeLike(search)
    whereClause += ` AND (c.name LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')`
    params.push(`%${escaped}%`, `%${escaped}%`)
  }

  // type 筛选
  if (type === 'public') {
    whereClause += ' AND c.is_public = 1 AND c.is_official = 0'
  } else if (type === 'private') {
    whereClause += ' AND c.is_public = 0'
  } else if (type === 'official') {
    whereClause += ' AND c.is_official = 1'
  }

  // 查询总数
  const totalSql = `SELECT COUNT(*) as total FROM collections c WHERE ${whereClause}`
  const totalResult = db.prepare(totalSql).get(...params) as { total: number }
  const total = totalResult.total

  // 查询列表
  const sql = `
    SELECT c.*, u.username, u.nickname,
      (SELECT COUNT(*) FROM collection_bookmarks WHERE collection_id = c.id) as bookmark_count,
      (SELECT COUNT(*) FROM collection_subscriptions WHERE collection_id = c.id) as subscriber_count
    FROM collections c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `

  const collections = db.prepare(sql).all(...params, limit, offset)

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
