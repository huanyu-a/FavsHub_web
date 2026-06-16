/**
 * GET /api/bookmarks — 获取书签列表（支持搜索和文件夹过滤）
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'
import { getConfigInt } from '../../utils/config'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const query = getQuery(event)
  const { folder_id, search } = query

  const db = getRawDb()

  // 可见性：
  //   游客 → 管理员公开书签
  //   普通用户 → 自己的 + 管理员公开的
  //   管理员 → 全部
  let visibilityClause: string
  const visParams: any[] = []
  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser?.is_admin) {
      visibilityClause = '1=1'
    } else {
      visibilityClause = `(b.user_id = ? OR (b.login_required = 0 AND b.user_id IN (SELECT id FROM users WHERE is_admin = 1)))`
      visParams.push(user.id)
    }
  } else {
    visibilityClause = '(b.login_required = 0 AND b.user_id IN (SELECT id FROM users WHERE is_admin = 1))'
  }

  let sql = `SELECT b.*, f.name as folder_name FROM bookmarks b LEFT JOIN folders f ON b.folder_id = f.id WHERE ${visibilityClause}`
  const params: any[] = [...visParams]

  if (search && typeof search === 'string') {
    const keywords = search.split(/\s+/).filter((k: string) => k.length > 0)
    const conditions = keywords.map(() => {
      params.push(...Array(3).fill(`%${search}%`))
      return `(b.title LIKE ? OR b.url LIKE ? OR b.description LIKE ?)`
    })
    sql += ` AND (${conditions.join(' AND ')})`
  }

  if (folder_id && folder_id !== 'all') {
    sql += ' AND b.folder_id = ?'
    params.push(folder_id as string)
  }

  sql += ` ORDER BY b.created_at DESC LIMIT ${getConfigInt('bookmarks_query_limit', 500)}`

  const bookmarks = db.prepare(sql).all(...params)

  // 查询文件夹：普通用户看自己的 + 管理员的
  let folders: any[]
  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser?.is_admin) {
      folders = db.prepare('SELECT * FROM folders ORDER BY name').all()
    } else {
      folders = db.prepare(
        'SELECT * FROM folders WHERE user_id = ? OR user_id IN (SELECT id FROM users WHERE is_admin = 1) ORDER BY name'
      ).all(user.id)
    }
  } else {
    folders = db.prepare('SELECT * FROM folders WHERE user_id IN (SELECT id FROM users WHERE is_admin = 1) ORDER BY name').all()
  }

  return { bookmarks, folders }
})
