/**
 * DELETE /api/tags/:id — 删除标签
 * 普通用户禁止删除，仅管理员可操作
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const { id } = getRouterParams(event)

  const db = getRawDb()

  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as any
  if (!tag) {
    throw createError({ statusCode: 404, data: { error: '标签不存在' } })
  }

  db.prepare('DELETE FROM tags WHERE id = ?').run(id)

  return { success: true }
})
