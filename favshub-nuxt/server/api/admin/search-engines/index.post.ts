/**
 * POST /api/admin/search-engines — 创建搜索引擎
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { name, label, url, icon, category, is_default } = body

  if (!name || !url) {
    throw createError({ statusCode: 400, data: { error: '名称和 URL 不能为空' } })
  }

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM search_engines').get() as any
  const result = db.prepare(`
    INSERT INTO search_engines (name, label, url, icon, category, sort_order, is_default) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, 
    label || name, 
    url, 
    icon || '', 
    category || 'SEARCH', 
    (maxOrder?.m || 0) + 1, 
    is_default ? 1 : 0
  )

  const engine = db.prepare('SELECT * FROM search_engines WHERE id = ?').get(result.lastInsertRowid)

  return { engine }
})
