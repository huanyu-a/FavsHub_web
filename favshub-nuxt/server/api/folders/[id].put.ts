/**
 * PUT /api/folders/:id — 更新文件夹
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const params = getRouterParams(event)
  const body = await readBody(event)
  const { name, sort_order } = body || {}

  const db = getRawDb()

  // 验证文件夹归属
  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(params.id, user.id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  const tx = db.transaction(() => {
    if (name !== undefined) {
      db.prepare('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?').run(name, folder.id, user.id)
    }
    if (sort_order !== undefined) {
      db.prepare('UPDATE folders SET sort_order = ? WHERE id = ? AND user_id = ?').run(sort_order, folder.id, user.id)
    }
  })
  tx()

  const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(folder.id)
  return { folder: updated }
})
