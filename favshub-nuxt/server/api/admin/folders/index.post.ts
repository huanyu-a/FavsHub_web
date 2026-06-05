/**
 * POST /api/admin/folders — 创建文件夹（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { name, user_id, parent_id } = body

  if (!name) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称不能为空' } })
  }
  if (!user_id) {
    throw createError({ statusCode: 400, data: { error: '必须指定用户 ID' } })
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id) as any
  if (!user) {
    throw createError({ statusCode: 404, data: { error: '用户不存在' } })
  }

  if (parent_id) {
    const parent = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(parent_id, user_id) as any
    if (!parent) {
      throw createError({ statusCode: 404, data: { error: '父文件夹不存在' } })
    }
  }

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM folders WHERE user_id = ?').get(user_id) as any
  const result = db.prepare('INSERT INTO folders (user_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)').run(
    user_id,
    name,
    parent_id || null,
    (maxOrder?.m || 0) + 1
  )

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid)
  return { folder }
})
