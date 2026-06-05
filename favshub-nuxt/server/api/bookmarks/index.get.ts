/**
 * GET /api/bookmarks — 获取书签列表（支持搜索和文件夹过滤）
 * 游客：只看管理员的公开书签
 * 登录用户：自己的全部 + 管理员的公开
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const query = getQuery(event)
  const { folder_id, search } = query

  const db = getRawDb()

  // 构建可见性条件
  let visibilityClause: string
  const visParams: any[] = []
  if (user) {
    visibilityClause = '(b.user_id = ? OR (b.login_required = 0 AND b.user_id IN (SELECT id FROM users WHERE is_admin = 1)))'
    visParams.push(user.id)
  } else {
    visibilityClause = '(b.login_required = 0 AND b.user_id IN (SELECT id FROM users WHERE is_admin = 1))'
  }

  let sql = `SELECT b.*, f.name as folder_name FROM bookmarks b LEFT JOIN folders f ON b.folder_id = f.id WHERE ${visibilityClause}`
  const params: any[] = [...visParams]

  if (search && typeof search === 'string') {
    const keywords = search.split(/\s+/).filter((k: string) => k.length > 0)
    const conditions = keywords.map(() => {
      return '(b.title LIKE ? OR b.url LIKE ? OR b.url LIKE ?)'
    })
    sql += ' AND (' + conditions.join(' OR ') + ')'
    for (const kw of keywords) {
      const q = `%${kw}%`
      let domainQ = q
      try {
        const match = kw.match(/^[\w.-]+\.[\w]{2,}/)
        if (match) domainQ = `%${match[0]}%`
      } catch { /* ignore */ }
      params.push(q, q, domainQ)
    }
  }

  if (folder_id) {
    sql += ' AND b.folder_id = ?'
    params.push(folder_id)
  }

  sql += ' ORDER BY b.sort_order, b.created_at'
  const bookmarks = db.prepare(sql).all(...params)

  // 文件夹：同样的可见性逻辑
  let folderSql: string
  let folderParams: any[] = []
  if (user) {
    folderSql = `SELECT DISTINCT fo.* FROM folders fo WHERE (fo.user_id = ? OR (fo.user_id IN (SELECT id FROM users WHERE is_admin = 1) AND fo.id IN (SELECT folder_id FROM bookmarks WHERE login_required = 0 AND user_id IN (SELECT id FROM users WHERE is_admin = 1)))) ORDER BY fo.sort_order, fo.created_at`
    folderParams = [user.id]
  } else {
    folderSql = `SELECT DISTINCT fo.* FROM folders fo WHERE fo.user_id IN (SELECT id FROM users WHERE is_admin = 1) AND fo.id IN (SELECT folder_id FROM bookmarks WHERE login_required = 0 AND user_id IN (SELECT id FROM users WHERE is_admin = 1)) ORDER BY fo.sort_order, fo.created_at`
  }
  const folders = db.prepare(folderSql).all(...folderParams)

  return { bookmarks, folders }
})
