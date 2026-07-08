/**
 * POST /api/admin/folders — 创建文件夹
 * 管理员：可创建任意用户的文件夹，可设置 login_required
 * 普通用户：仅可创建自己的文件夹，且强制 login_required=1
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()

  const body = await readBody(event)
  const { name, user_id, parent_id, icon, sort_order, login_required } = body

  if (!name) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称不能为空' } })
  }

  // 非管理员强制只能创建自己的文件夹，且为私有
  const ownerId = isAdmin ? (user_id || auth.id) : auth.id
  const finalLoginRequired = isAdmin ? (login_required ? 1 : 0) : 1

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
    finalLoginRequired
  )

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid)
  return { folder }
})
