/**
 * PUT /api/admin/folders/:id — 更新文件夹（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAuth(event)
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

  const body = await readBody(event)
  const { name, icon, parent_id, sort_order, login_required } = body

  if (name !== undefined) {
    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folderId)
  }
  if (icon !== undefined) {
    db.prepare('UPDATE folders SET icon = ? WHERE id = ?').run(icon, folderId)
  }
  if (parent_id !== undefined) {
    if (parent_id === folderId) {
      throw createError({ statusCode: 400, data: { error: '不能将文件夹设为自己的子文件夹' } })
    }
    db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parent_id || null, folderId)
  }
  if (sort_order !== undefined) {
    db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?').run(sort_order, folderId)
  }
  if (login_required !== undefined) {
    db.prepare('UPDATE folders SET login_required = ? WHERE id = ?').run(login_required ? 1 : 0, folderId)
  }

  const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId)
  return { folder: updated }
})
