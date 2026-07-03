/**
 * PUT /api/admin/search-engines/:id — 更新搜索引擎
 * 管理员可编辑所有，普通用户只能编辑自己创建的
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const db = getRawDb()

  const isAdmin = true

  const { id } = getRouterParams(event)
  const engineId = parseInt(id)
  if (isNaN(engineId)) {
    throw createError({ statusCode: 400, data: { error: '无效的搜索引擎 ID' } })
  }

  const engine = db.prepare('SELECT id, user_id FROM search_engines WHERE id = ?').get(engineId) as any
  if (!engine) {
    throw createError({ statusCode: 404, data: { error: '搜索引擎不存在' } })
  }

  // 非管理员只能编辑自己创建的引擎
  if (!isAdmin && engine.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权编辑此搜索引擎' } })
  }

  const body = await readBody(event)
  const { name, label, url, icon, category, sort_order, is_default } = body

  if (name !== undefined) {
    db.prepare('UPDATE search_engines SET name = ? WHERE id = ?').run(name, engineId)
  }
  if (label !== undefined) {
    db.prepare('UPDATE search_engines SET label = ? WHERE id = ?').run(label, engineId)
  }
  if (url !== undefined) {
    db.prepare('UPDATE search_engines SET url = ? WHERE id = ?').run(url, engineId)
  }
  if (icon !== undefined) {
    db.prepare('UPDATE search_engines SET icon = ? WHERE id = ?').run(icon, engineId)
  }
  if (category !== undefined) {
    db.prepare('UPDATE search_engines SET category = ? WHERE id = ?').run(category, engineId)
  }
  if (sort_order !== undefined) {
    db.prepare('UPDATE search_engines SET sort_order = ? WHERE id = ?').run(sort_order, engineId)
  }
  if (is_default !== undefined) {
    db.prepare('UPDATE search_engines SET is_default = ? WHERE id = ?').run(is_default ? 1 : 0, engineId)
  }

  const updated = db.prepare('SELECT * FROM search_engines WHERE id = ?').get(engineId)

  return { engine: updated }
})
