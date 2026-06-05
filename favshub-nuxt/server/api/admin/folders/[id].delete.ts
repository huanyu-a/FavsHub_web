/**
 * DELETE /api/admin/folders/:id — 删除文件夹（管理员）
 * 书签的 folder_id 设为 NULL，子文件夹挂载到被删除文件夹的父级
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const folderId = parseInt(id)
  if (isNaN(folderId)) {
    throw createError({ statusCode: 400, data: { error: '无效的文件夹 ID' } })
  }

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ?').run(folderId)
    db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ?').run(folder.parent_id, folderId)
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId)
  })
  tx()

  return { success: true, message: '已删除文件夹' }
})
