/**
 * DELETE /api/prompts/folders/:id — 删除提示词文件夹
 * 普通用户禁止删除，仅管理员可操作
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const { id } = getRouterParams(event)

  const db = getRawDb()

  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  db.prepare('UPDATE prompts SET folder_id = NULL WHERE folder_id = ?').run(id)
  db.prepare('DELETE FROM prompt_folders WHERE id = ?').run(id)

  return { success: true }
})
