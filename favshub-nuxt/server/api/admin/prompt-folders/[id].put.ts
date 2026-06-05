/**
 * PUT /api/admin/prompt-folders/:id — 更新提示词文件夹（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '无效的文件夹 ID' } })
  }

  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  const body = await readBody(event)
  const { name, parent_id, icon } = body

  if (name !== undefined) {
    db.prepare('UPDATE prompt_folders SET name = ? WHERE id = ?').run(name, id)
  }
  if (icon !== undefined) {
    db.prepare('UPDATE prompt_folders SET icon = ? WHERE id = ?').run(icon, id)
  }
  if (parent_id !== undefined) {
    if (parent_id === id) {
      throw createError({ statusCode: 400, data: { error: '不能将文件夹设为自己的子文件夹' } })
    }
    db.prepare('UPDATE prompt_folders SET parent_id = ? WHERE id = ?').run(parent_id || null, id)
  }

  db.prepare('UPDATE prompt_folders SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  const updated = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id)
  return { folder: updated }
})
