/**
 * GET /api/admin/search-engines — 获取所有搜索引擎
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const db = getRawDb()

  const isAdmin = true

  const engines = db.prepare(`
    SELECT * FROM search_engines
    ORDER BY
      CASE category
        WHEN 'SEARCH' THEN 1
        WHEN 'AI' THEN 2
        WHEN 'SOCIAL' THEN 3
        ELSE 4
      END,
      sort_order, id
  `).all() as any[]

  // 为每个引擎添加权限信息
  const enginesWithPerm = engines.map(e => ({
    ...e,
    _canEdit: isAdmin || e.user_id === user.id,
    _canDelete: isAdmin || e.user_id === user.id,
  }))

  return { engines: enginesWithPerm, isAdmin }
})
