/**
 * POST /api/admin/folders — 创建文件夹（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { name, user_id, parent_id, icon, sort_order, login_required } = body

  if (!name) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称不能为空' } })
  }
  // 未指定 user_id 时使用当前认证用户
  const ownerId = user_id || auth.id

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(ownerId) as any
  if (!user) {
    throw createError({ statusCode: 404, data: { error: '用户不存在' } })
  }

  if (parent_id) {
    const parent = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(parent_id, ownerId) as any
    if (!parent) {
      throw createError({ statusCode: 404, data: { error: '父文件夹不存在' } })
    }
  }

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM folders WHERE user_id = ?').get(ownerId) as any
  const result = db.prepare('INSERT INTO folders (user_id, name, parent_id, icon, sort_order, login_required) VALUES (?, ?, ?, ?, ?, ?)').run(
    ownerId,
    name,
    parent_id || null,
    icon || null,
    sort_order !== undefined ? sort_order : (maxOrder?.m || 0) + 1,
    login_required ? 1 : 0
  )

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid)
  return { folder }
})
