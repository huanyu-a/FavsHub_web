/**
 * PUT /api/admin/folders/reorder — 批量更新文件夹排序（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { items } = body

  if (!Array.isArray(items)) {
    throw createError({ statusCode: 400, data: { error: 'items 必须是数组' } })
  }

  const stmt = db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?')
  const tx = db.transaction(() => {
    for (const item of items) {
      stmt.run(item.sort_order, item.id)
    }
  })
  tx()

  return { success: true }
})
