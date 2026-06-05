/**
 * DELETE /api/admin/search-engines/:id — 删除搜索引擎
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'

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

  db.prepare('DELETE FROM search_engines WHERE id = ?').run(engineId)

  return { success: true, message: '已删除搜索引擎' }
})
