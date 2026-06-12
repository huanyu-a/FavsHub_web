/**
 * GET /api/admin/search-engines — 获取所有搜索引擎
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  // 检查是否为管理员
  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

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
