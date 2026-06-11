/**
 * GET /api/prompts — 获取提示词列表
 * 复刻旧版 wwwroot/server/routes/prompts.js GET /
 * 游客：管理员的公开 prompts
 * 登录用户：自己的 + 管理员的公开
 * Query: folder_id, tag_ids (逗号分隔), search, favorites, limit
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const query = getQuery(event)
  const { folder_id, tag_ids, search, favorites, limit } = query

  const db = getRawDb()

  // ── 可见性条件（与旧版一致） ──────────────────────────────────
  let visibilityClause: string
  const visParams: any[] = []
  if (user) {
    visibilityClause = '(p.user_id = ? OR (p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)))'
    visParams.push(user.id)
  } else {
    visibilityClause = '(p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1))'
  }

  // 基础查询：LEFT JOIN prompt_folders 获取 folder_name（与旧版一致）
  let sql = `SELECT p.*, pf.name as folder_name FROM prompts p LEFT JOIN prompt_folders pf ON p.folder_id = pf.id AND p.user_id = pf.user_id WHERE ${visibilityClause}`
  const params: any[] = [...visParams]

  // ── 文件夹过滤 ──────────────────────────────────────────────
  if (folder_id) {
    sql += ' AND p.folder_id = ?'
    params.push(folder_id)
  }

  // ── 收藏过滤 ──────────────────────────────────────────────
  if (favorites === '1' || favorites === 'true') {
    sql += ' AND p.is_favorite = 1'
  }

  // ── 多关键词搜索（复刻旧版 OR 逻辑） ──────────────────────
  // 每个关键词独立一组：(title LIKE ? OR description LIKE ? OR content LIKE ? OR tag子查询)
  // 多个关键词之间 OR 连接
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

      // 多个关键词之间 OR 连接（匹配任一关键词即返回）
      sql += ` AND (${keywordGroups.join(' OR ')})`
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

  // ── 排序：更新时间降序（与旧版一致） ──────────────────────
  sql += ' ORDER BY p.updated_at DESC'

  // ── limit 参数 ──────────────────────────────────────────────
  if (limit && typeof limit === 'string') {
    const n = parseInt(limit, 10)
    if (!isNaN(n) && n > 0) {
      sql += ` LIMIT ${n}`
    }
  }

  const prompts = db.prepare(sql).all(...params) as any[]

  // ── 批量获取标签（避免 N+1，与旧版一致） ──────────────────
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
