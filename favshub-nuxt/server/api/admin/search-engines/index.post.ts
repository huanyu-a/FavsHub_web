/**
 * POST /api/admin/search-engines — 创建搜索引擎
 * 管理员：直接创建，状态为已启用
 * 普通用户：创建后需管理员审核，状态为"审核中"
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()

  const body = await readBody(event)
  const { name, label, url, icon, category, is_default } = body

  if (!name || !url) {
    throw createError({ statusCode: 400, data: { error: '名称和 URL 不能为空' } })
  }

  // 非管理员创建需审核
  const status = isAdmin ? 'approved' : 'pending'

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM search_engines').get() as any
  const result = db.prepare(`
    INSERT INTO search_engines (user_id, name, label, url, icon, category, sort_order, is_default, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    auth.id,
    name,
    label || name,
    url,
    icon || '',
    category || 'SEARCH',
    (maxOrder?.m || 0) + 1,
    is_default ? 1 : 0,
    status
  )

  const engine = db.prepare('SELECT * FROM search_engines WHERE id = ?').get(result.lastInsertRowid)
  return { engine, status }
})