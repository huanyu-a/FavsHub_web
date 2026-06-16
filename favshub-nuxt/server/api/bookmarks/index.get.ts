/**
 * GET /api/bookmarks — 获取书签列表（支持搜索和文件夹过滤）
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'
import { getConfigInt } from '../../utils/config'

/** 根据继承规则过滤文件夹（子文件夹继承父文件夹的 login_required） */
function filterByInheritance(folders: any[]): any[] {
  function isLocked(f: any, visited = new Set<number>()): boolean {
    if (f.login_required) return true
    if (f.parent_id == null) return false
    if (visited.has(f.parent_id)) return false
    visited.add(f.parent_id)
    const parent = folders.find(p => p.id === f.parent_id)
    if (!parent) return false
    return isLocked(parent, visited)
  }
  return folders.filter(f => !isLocked(f))
}

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

  // 查询文件夹：按 login_required 过滤可见性（含继承）
  let folders: any[]
  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser?.is_admin) {
      // 管理员看全部
      folders = db.prepare('SELECT * FROM folders ORDER BY parent_id NULLS FIRST, sort_order').all()
    } else {
      // 登录用户：自己的全部 + 管理员的（继承过滤）
      const allAdminFolders = db.prepare(
        `SELECT * FROM folders
         WHERE user_id IN (SELECT id FROM users WHERE is_admin = 1)
         ORDER BY parent_id NULLS FIRST, sort_order`
      ).all() as any[]
      const myFolders = db.prepare(
        'SELECT * FROM folders WHERE user_id = ? ORDER BY parent_id NULLS FIRST, sort_order'
      ).all(user.id) as any[]
      const visibleAdminFolders = filterByInheritance(allAdminFolders)
      const myIds = new Set(myFolders.map(f => f.id))
      const merged = [...myFolders, ...visibleAdminFolders.filter(f => !myIds.has(f.id))]
      folders = merged.sort((a: any, b: any) => {
        const ap = a.parent_id ?? 0, bp = b.parent_id ?? 0
        if (ap !== bp) return ap - bp
        return (a.sort_order || 0) - (b.sort_order || 0)
      })
    }
  } else {
    // 游客：只看管理员的公开文件夹（继承过滤）
    const allAdminFolders = db.prepare(
      `SELECT * FROM folders
       WHERE user_id IN (SELECT id FROM users WHERE is_admin = 1)
       ORDER BY parent_id NULLS FIRST, sort_order`
    ).all() as any[]
    folders = filterByInheritance(allAdminFolders)
  }

  return { bookmarks, folders }
})
