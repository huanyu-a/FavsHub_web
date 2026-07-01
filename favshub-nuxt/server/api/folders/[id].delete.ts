/**
 * DELETE /api/folders/:id — 删除文件夹
 * 仅文件夹所有者或管理员可操作
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const params = getRouterParams(event)

  const db = getRawDb()

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(params.id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  // 所有权检查：仅文件夹所有者或管理员可删除
  if (folder.user_id !== user.id) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (!dbUser?.is_admin) {
      throw createError({ statusCode: 403, data: { error: '无权删除此文件夹' } })
    }
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ?').run(folder.id)
    db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ?').run(folder.parent_id, folder.id)
    db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id)
  })
  tx()

  return { success: true }
})
