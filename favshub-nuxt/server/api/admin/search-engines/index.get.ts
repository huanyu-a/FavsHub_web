/**
 * GET /api/admin/search-engines — 获取所有搜索引擎
 * 管理员：返回全部引擎（含审核中、下线）
 * 普通用户：返回自己的引擎（全部状态）+ 已审核通过的全局引擎
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  let engines: any[]
  if (isAdmin) {
    engines = db.prepare(`
      SELECT * FROM search_engines
      ORDER BY
        CASE category
          WHEN 'SEARCH' THEN 1
          WHEN 'AI' THEN 2
          WHEN 'SOCIAL' THEN 3
          ELSE 4
        END,
        status,
        sort_order, id
    `).all()
  } else {
    // 普通用户：自己的所有引擎 + 全局已审核的
    engines = db.prepare(`
      SELECT * FROM search_engines
      WHERE user_id = ? OR (user_id != ? AND status = 'approved')
      ORDER BY
        CASE category
          WHEN 'SEARCH' THEN 1
          WHEN 'AI' THEN 2
          WHEN 'SOCIAL' THEN 3
          ELSE 4
        END,
        sort_order, id
    `).all(auth.id, auth.id)
  }

  const enginesWithPerm = engines.map(e => ({
    ...e,
    _canEdit: isAdmin || e.user_id === auth.id,
    _canDelete: isAdmin || e.user_id === auth.id,
  }))

  return { engines: enginesWithPerm, isAdmin }
})