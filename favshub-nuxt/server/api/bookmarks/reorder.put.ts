/**
 * PUT /api/bookmarks/reorder — 批量重排序书签
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { items } = body || {}

  if (!Array.isArray(items)) {
    throw createError({ statusCode: 400, data: { error: 'items 必须是数组' } })
  }

  const db = getRawDb()
  const now = Date.now()
  const update = db.prepare('UPDATE bookmarks SET sort_order = ?, folder_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')

  const tx = db.transaction(() => {
    for (const item of items) {
      update.run(item.sort_order, item.folder_id ?? null, now, item.id, user.id)
    }
  })
  tx()

  return { success: true }
})
