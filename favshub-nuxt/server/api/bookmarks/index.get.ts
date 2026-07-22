/**
 * GET /api/bookmarks — 获取书签列表（支持搜索和文件夹过滤）
 */
import { LRUCache } from 'lru-cache'
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'
import { getConfigInt } from '../../utils/config'

/**
 * FIX: MAJOR #9 - 使用 LRU 缓存避免每次请求都全表扫描计算文件夹继承
 */
const lockedFoldersCache = new LRUCache<number, Set<number>>({
  max: 100,
  ttl: 60000 // 1 分钟
})

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

/**
 * FIX: MAJOR #9 - 缓存文件夹锁定状态计算结果
 */
function getLockedFolders(userId: number | null, db: any): Set<number> {
  const cacheKey = userId || -1
  const cached = lockedFoldersCache.get(cacheKey)
  if (cached) return cached

  const lockedFolderIds = new Set<number>()
  const allFolders = db.prepare('SELECT id, parent_id, login_required FROM folders').all() as { id: number; parent_id: number | null; login_required: number }[]

  function isLocked(f: typeof allFolders[0], visited = new Set<number>()): boolean {
    if (f.login_required) return true
    if (f.parent_id == null) return false
    if (visited.has(f.parent_id)) return false
    visited.add(f.parent_id)
    const parent = allFolders.find(p => p.id === f.parent_id)
    if (!parent) return false
    return isLocked(parent, visited)
  }

  for (const f of allFolders) {
    if (isLocked(f)) lockedFolderIds.add(f.id)
  }

  lockedFoldersCache.set(cacheKey, lockedFolderIds)
  return lockedFolderIds
}

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const query = getQuery(event)
  const { folder_id, search, collection_id } = query

  const db = getRawDb()

  // 可见性：
  //   游客 → 管理员公开书签（自身公开 + 所属文件夹公开）
  //   普通用户 → 自己的 + 管理员公开的
  //   管理员 → 全部
  //
  // 注意：login_required 从文件夹继承 — 父文件夹设为登录可见时，子文件夹内的书签也登录可见
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

  // 收集因文件夹 login_required 继承而被锁定的文件夹 ID（非管理员需要排除这些文件夹内的书签）
  // FIX: MAJOR #9 - 使用缓存函数
  let lockedFolderIds = new Set<number>()
  if (!user || !(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined)?.is_admin) {
    lockedFolderIds = getLockedFolders(user?.id || null, db)
  }

  // 首页/个人书签列表只显示有 label 的个人书签；label='' 为精选集公共池，不混入
  let sql = `SELECT b.*, f.name as folder_name FROM bookmarks b LEFT JOIN folders f ON b.folder_id = f.id WHERE ${visibilityClause} AND COALESCE(b.label, '') != ''`
  const params: any[] = [...visParams]

  // 非管理员排除"文件夹继承 login_required"的书签（但登录用户仍可看自己文件夹里的）
  // 注意：folder_id IS NULL 的书签（未分类）不受文件夹锁定影响，必须保留
  if (lockedFolderIds.size > 0) {
    if (user) {
      sql += ` AND (b.user_id = ? OR b.folder_id IS NULL OR b.folder_id NOT IN (${[...lockedFolderIds].map(() => '?').join(',')}))`
      params.push(user.id, ...lockedFolderIds)
    } else {
      sql += ` AND (b.folder_id IS NULL OR b.folder_id NOT IN (${[...lockedFolderIds].map(() => '?').join(',')}))`
      params.push(...lockedFolderIds)
    }
  }

  if (search && typeof search === 'string') {
    // 转义 LIKE 通配符，防止注入
    const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&')
    const keywords = search.split(/\s+/).filter((k: string) => k.length > 0)
    const conditions = keywords.map((k) => {
      const escaped = escapeLike(k)
      params.push(`%${escaped}%`, `%${escaped}%`)
      return `(b.title LIKE ? ESCAPE '\\' OR b.url LIKE ? ESCAPE '\\')`
    })
    sql += ` AND (${conditions.join(' AND ')})`
  }

  if (folder_id && folder_id !== 'all') {
    sql += ' AND b.folder_id = ?'
    params.push(folder_id as string)
  }

  // 按精选集筛选：source LIKE '%"collection:xxx"%'（转义 _ 和 %）
  if (collection_id && typeof collection_id === 'string') {
    const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&')
    sql += ` AND b.source LIKE ? ESCAPE '\\'`
    params.push(`%"collection:${escapeLike(collection_id)}"%`)
  }

  sql += ` ORDER BY b.created_at DESC LIMIT ?`
  params.push(getConfigInt('bookmarks_query_limit', 500))

  const bookmarks = db.prepare(sql).all(...params) as { folder_id?: number | null }[]

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

  // 首页侧栏：只返回「当前个人书签列表」中实际用到的文件夹及其祖先
  // （公共池专用分类 bookmark 数为 0，不应出现在个人书签导航）
  folders = filterFoldersUsedByBookmarks(folders, bookmarks)

  return { bookmarks, folders }
})

/** 保留书签实际引用的 folder_id 及其祖先，剔除空分类 */
function filterFoldersUsedByBookmarks(folders: any[], bookmarks: { folder_id?: number | null }[]): any[] {
  if (!folders.length) return folders

  const byId = new Map<number, any>()
  for (const f of folders) byId.set(f.id, f)

  const keep = new Set<number>()
  for (const b of bookmarks) {
    let id = b.folder_id ?? null
    while (id != null && byId.has(id) && !keep.has(id)) {
      keep.add(id)
      const parent = byId.get(id)?.parent_id
      id = parent == null ? null : parent
    }
  }

  return folders.filter(f => keep.has(f.id))
}
