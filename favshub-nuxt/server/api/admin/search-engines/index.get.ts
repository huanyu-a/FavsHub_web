/**
 * GET /api/admin/search-engines — 获取所有搜索引擎
 * 管理员：返回全部引擎（含审核中、下线）
 * 普通用户：返回自己的引擎（全部状态）+ 已审核通过的全局引擎
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()

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