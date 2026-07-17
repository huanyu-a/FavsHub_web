/**
 * PUT /api/admin/search-engines/:id — 更新搜索引擎
 * 仅管理员可编辑（含修改 status）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const engineId = parseInt(id)
  if (isNaN(engineId)) {
    throw createError({ statusCode: 400, data: { error: '无效的搜索引擎 ID' } })
  }

  const engine = db.prepare('SELECT id FROM search_engines WHERE id = ?').get(engineId) as any
  if (!engine) {
    throw createError({ statusCode: 404, data: { error: '搜索引擎不存在' } })
  }

  const body = await readBody(event)
  const { name, label, url, icon, category, sort_order, is_default, status } = body

  // 构建动态 UPDATE，事务包裹确保原子性
  const setClauses: string[] = []
  const params: any[] = []

  if (name !== undefined) { setClauses.push('name = ?'); params.push(name) }
  if (label !== undefined) { setClauses.push('label = ?'); params.push(label) }
  if (url !== undefined) { setClauses.push('url = ?'); params.push(url) }
  if (icon !== undefined) { setClauses.push('icon = ?'); params.push(icon) }
  if (category !== undefined) { setClauses.push('category = ?'); params.push(category) }
  if (sort_order !== undefined) { setClauses.push('sort_order = ?'); params.push(sort_order) }
  if (is_default !== undefined) { setClauses.push('is_default = ?'); params.push(is_default ? 1 : 0) }
  if (status !== undefined && ['approved', 'pending', 'disabled'].includes(status)) {
    setClauses.push('status = ?'); params.push(status)
  }

  if (setClauses.length > 0) {
    params.push(engineId)
    db.transaction(() => {
      db.prepare(`UPDATE search_engines SET ${setClauses.join(', ')} WHERE id = ?`).run(...params)
    })()
  }

  const updated = db.prepare('SELECT * FROM search_engines WHERE id = ?').get(engineId)

  return { engine: updated }
})
