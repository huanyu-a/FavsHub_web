/**
 * GET /api/prompts — 获取提示词列表
 * 游客：管理员的公开 prompts
 * 登录用户：自己的 + 管理员的公开
 * Query: folder_id, tag_ids (逗号分隔), search, favorites
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const query = getQuery(event)
  const { folder_id, tag_ids, search, favorites } = query

  const db = getRawDb()

  // 可见性条件
  let visibilityClause: string
  const visParams: any[] = []
  if (user) {
    visibilityClause = '(p.user_id = ? OR (p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)))'
    visParams.push(user.id)
  } else {
    visibilityClause = '(p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1))'
  }

  let sql = `SELECT p.* FROM prompts p WHERE ${visibilityClause}`
  const params: any[] = [...visParams]

  // 文件夹过滤
  if (folder_id) {
    sql += ' AND p.folder_id = ?'
    params.push(folder_id)
  }

  // 收藏过滤
  if (favorites === '1' || favorites === 'true') {
    sql += ' AND p.is_favorite = 1'
  }

  // 多关键词搜索（OR 逻辑）
  if (search && typeof search === 'string') {
    const keywords = search.split(/\s+/).filter((k: string) => k.length > 0)
    if (keywords.length > 0) {
      // 查找包含关键词的 prompt_ids（标签名称匹配）
      const tagMatches: string[] = []
      const tagParams: any[] = []
      for (const kw of keywords) {
        tagMatches.push(`pt.prompt_id IN (SELECT pt2.prompt_id FROM prompt_tags pt2 JOIN tags t ON pt2.tag_id = t.id WHERE t.name LIKE ?)`)
        tagParams.push(`%${kw}%`)
      }

      const conditions = keywords.map(() => {
        return '(p.title LIKE ? OR p.description LIKE ? OR p.content LIKE ?)'
      })

      const tagCondition = tagMatches.length > 0 ? ` OR p.id IN (${tagMatches.join(' OR ')})` : ''
      sql += ` AND ((${conditions.join(' OR ')})${tagCondition})`

      for (const kw of keywords) {
        const q = `%${kw}%`
        params.push(q, q, q)
      }
      params.push(...tagParams)
    }
  }

  // 如果指定了 tag_ids，过滤出包含这些标签的 prompts
  if (tag_ids && typeof tag_ids === 'string') {
    const ids = tag_ids.split(',').filter(Boolean)
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',')
      sql += ` AND p.id IN (SELECT prompt_id FROM prompt_tags WHERE tag_id IN (${placeholders}))`
      params.push(...ids)
    }
  }

  sql += ' ORDER BY p.updated_at DESC, p.created_at DESC'
  const prompts = db.prepare(sql).all(...params) as any[]

  // 批量获取标签（避免 N+1）
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
