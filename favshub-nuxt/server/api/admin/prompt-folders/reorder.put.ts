/**
 * PUT /api/admin/prompt-folders/reorder — 批量更新提示词文件夹排序（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { items } = body

  if (!Array.isArray(items)) {
    throw createError({ statusCode: 400, data: { error: 'items 必须是数组' } })
  }

  const stmt = db.prepare('UPDATE prompt_folders SET sort_order = ? WHERE id = ?')
  const tx = db.transaction(() => {
    for (const item of items) {
      stmt.run(item.sort_order, item.id)
    }
  })
  tx()

  return { success: true }
})
