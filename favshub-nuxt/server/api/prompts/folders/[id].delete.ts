/**
 * DELETE /api/prompts/folders/:id — 删除提示词文件夹
 * 删除时将关联的 prompts 的 folder_id 置为 NULL
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)

  const db = getRawDb()

  // 验证归属
  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }
  if (folder.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权删除此文件夹' } })
  }

  // 将关联的 prompts 的 folder_id 置为 NULL
  db.prepare('UPDATE prompts SET folder_id = NULL WHERE folder_id = ?').run(id)

  // 删除文件夹
  db.prepare('DELETE FROM prompt_folders WHERE id = ?').run(id)

  return { success: true }
})
