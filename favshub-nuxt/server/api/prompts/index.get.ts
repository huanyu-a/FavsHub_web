/**
 * GET /api/prompts — 获取提示词列表
 * 游客：管理员的公开 prompts
 * 管理员：全部
 * 普通登录用户：自己的 + 管理员公开的
 * Query: folder_id, tag_ids (逗号分隔), search, favorites, limit
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const query = getQuery(event)
  const { folder_id, tag_ids, search, favorites, limit, sort, recycle } = query

  const db = getRawDb()

  // ── 可见性条件 ──────────────────────────────────────────────
  // 管理员：看全部
  // 普通登录用户：自己的 + 管理员公开的
  // 游客：管理员的公开提示词
  let visibilityClause: string
  const visParams: any[] = []
  let currentUserIsAdmin = false
  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    currentUserIsAdmin = !!dbUser?.is_admin
    if (currentUserIsAdmin) {
      visibilityClause = '1=1'
    } else {
      visibilityClause = `(p.user_id = ? OR (p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)))`
      visParams.push(user.id)
    }
  } else {
    visibilityClause = '(p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1))'
  }

  // ── 文件夹 login_required 继承过滤（SQL 递归 CTE）────────
  // 非管理员需要排除"文件夹继承 login_required"的提示词
  // 使用 SQLite 递归 CTE 直接在 SQL 中计算锁定文件夹集合，避免全表加载到 JS
  const lockedFolderIds: string[] = []
  if (!currentUserIsAdmin) {
    const lockedRows = db.prepare(`
      WITH RECURSIVE locked_chain(id) AS (
        -- 基准：直接设置 login_required 的文件夹
        SELECT id FROM prompt_folders WHERE login_required = 1
        UNION
        -- 递归：父文件夹被锁定的子文件夹
        SELECT pf.id FROM prompt_folders pf
        INNER JOIN locked_chain lc ON pf.parent_id = lc.id
      )
      SELECT id FROM locked_chain
    `).all() as { id: string }[]
    lockedFolderIds.push(...lockedRows.map(r => r.id))
  }

  // 基础查询：LEFT JOIN prompt_folders 获取 folder_name
  // 同时 LEFT JOIN users 获取 owner_is_admin
  let sql = `SELECT p.*, pf.name as folder_name, u.is_admin as owner_is_admin FROM prompts p LEFT JOIN prompt_folders pf ON p.folder_id = pf.id AND p.user_id = pf.user_id LEFT JOIN users u ON p.user_id = u.id WHERE ${visibilityClause}`
  const params: any[] = [...visParams]

  // 文件夹 login_required 继承过滤（NULL folder_id 安全处理）
  if (lockedFolderIds.length > 0) {
    const placeholders = lockedFolderIds.map(() => '?').join(',')
    if (user) {
      sql += ` AND (p.user_id = ? OR p.folder_id IS NULL OR p.folder_id NOT IN (${placeholders}))`
      params.push(user.id, ...lockedFolderIds)
    } else {
      sql += ` AND (p.folder_id IS NULL OR p.folder_id NOT IN (${placeholders}))`
      params.push(...lockedFolderIds)
    }
  }

  // ── 文件夹过滤 ──────────────────────────────────────────────
  if (folder_id) {
    sql += ' AND p.folder_id = ?'
    params.push(folder_id)
  }

  // ── 收藏过滤 ──────────────────────────────────────────────
  if (favorites === '1' || favorites === 'true') {
    sql += ' AND p.is_favorite = 1'
  }

  // ── 多关键词搜索（AND 逻辑） ─────────────────────────────────
  // 每个关键词独立一组：(title LIKE ? OR description LIKE ? OR content LIKE ? OR tag子查询)
  // 多个关键词之间 AND 连接（要求所有关键词都匹配）
  if (search && typeof search === 'string') {
    const keywords = search.split(/\s+/).filter((k: string) => k.length > 0)
    if (keywords.length > 0) {
      const keywordGroups: string[] = []

      for (const kw of keywords) {
        const like = `%${kw}%`
        // 每个关键词：匹配 title / description / content / 标签名称
        keywordGroups.push(
          `(p.title LIKE ? OR p.description LIKE ? OR p.content LIKE ? OR p.id IN (SELECT pt.prompt_id FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE t.name LIKE ?))`
        )
        params.push(like, like, like, like)
      }

      // 多个关键词之间 AND 连接（全部关键词匹配才返回）
      sql += ` AND (${keywordGroups.join(' AND ')})`
    }
  }

  // ── 标签过滤（要求所有标签都匹配） ──────────────────────
  if (tag_ids && typeof tag_ids === 'string') {
    const ids = tag_ids.split(',').filter(Boolean)
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',')
      sql += ` AND p.id IN (SELECT prompt_id FROM prompt_tags WHERE tag_id IN (${placeholders}) GROUP BY prompt_id HAVING COUNT(DISTINCT tag_id) = ?)`
      params.push(...ids, ids.length)
    }
  }

  // ── 回收站过滤：默认排除软删除，recycle=1 时只返回已删除 ──────
  if (recycle === '1' || recycle === 'true') {
    sql += ' AND p.deleted_at IS NOT NULL'
  } else {
    sql += ' AND p.deleted_at IS NULL'
  }

  // ── 排序 ───────────────────────────────────────────────────
  const sortField = typeof sort === 'string' ? sort : ''
  switch (sortField) {
    case 'usage':
      sql += ' ORDER BY p.usage_count DESC'
      break
    case 'created':
      sql += ' ORDER BY p.created_at DESC'
      break
    case 'title':
      sql += ' ORDER BY p.title COLLATE NOCASE ASC'
      break
    default:
      sql += ' ORDER BY p.updated_at DESC'
      break
  }

  // ── limit 参数 ──────────────────────────────────────────────
  if (limit && typeof limit === 'string') {
    const n = parseInt(limit, 10)
    if (!isNaN(n) && n > 0) {
      sql += ` LIMIT ${Math.min(n, 1000)}`
    }
  }

  const prompts = db.prepare(sql).all(...params) as any[]

  // ── 批量获取标签（避免 N+1）────────────────────────────────
  if (prompts.length > 0) {
    const promptIds = prompts.map(p => p.id)
    const placeholders = promptIds.map(() => '?').join(',')
    const tagRows = db.prepare(`
      SELECT pt.prompt_id, t.id, t.name, t.color
      FROM prompt_tags pt
      JOIN tags t ON pt.tag_id = t.id
      WHERE pt.prompt_id IN (${placeholders})
    `).all(...promptIds) as any[]

    const tagMap: Record<string, any[]> = {}
    for (const tr of tagRows) {
      if (!tagMap[tr.prompt_id]) tagMap[tr.prompt_id] = []
      tagMap[tr.prompt_id].push({ id: tr.id, name: tr.name, color: tr.color })
    }

    for (const p of prompts) {
      ;(p as any).prompt_id = p.id
      p.tags = tagMap[p.id] || []
    }
  }

  return { prompts }
})
