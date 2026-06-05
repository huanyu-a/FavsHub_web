/**
 * DELETE /api/folders/:id — 删除文件夹
 * 书签的 folder_id 置空，子文件夹重新挂载到父级
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const params = getRouterParams(event)

  const db = getRawDb()

  // 验证文件夹归属
  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(params.id, user.id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  const tx = db.transaction(() => {
    // 书签的 folder_id 置空
    db.prepare('UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').run(folder.id, user.id)
    // 子文件夹重新挂载到父级
    db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?').run(folder.parent_id, folder.id, user.id)
    // 删除文件夹
    db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id)
  })
  tx()

  return { success: true }
})
