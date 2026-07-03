/**
 * DELETE /api/admin/search-engines/:id — 删除搜索引擎
 * 管理员可删除所有，普通用户只能删除自己创建的
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'

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

  // 非管理员只能删除自己创建的引擎
  if (!isAdmin && engine.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权删除此搜索引擎' } })
  }

  db.prepare('DELETE FROM search_engines WHERE id = ?').run(engineId)

  return { success: true, message: '已删除搜索引擎' }
})
