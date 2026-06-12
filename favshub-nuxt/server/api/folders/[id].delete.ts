/**
 * DELETE /api/folders/:id — 删除文件夹
 * 普通用户禁止删除，仅管理员可操作
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const params = getRouterParams(event)

  const db = getRawDb()

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(params.id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ?').run(folder.id)
    db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ?').run(folder.parent_id, folder.id)
    db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id)
  })
  tx()

  return { success: true }
})
