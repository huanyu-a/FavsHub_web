/**
 * POST /api/folders — 创建文件夹
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { name, parent_id, login_required, icon } = body || {}

  if (!name) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称不能为空' } })
  }
  if (name.length > 128) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称最长 128 字符' } })
  }

  const db = getRawDb()

  // 校验 parent_id 归属（防止跨用户挂载文件夹）
  if (parent_id) {
    const parent = db.prepare('SELECT user_id FROM folders WHERE id = ?').get(parent_id) as { user_id: number } | undefined
    if (!parent) {
      throw createError({ statusCode: 400, data: { error: '父文件夹不存在' } })
    }
    if (parent.user_id !== user.id) {
      throw createError({ statusCode: 403, data: { error: '无权在此文件夹下创建子文件夹' } })
    }
  }

  // 可见性：管理员可自由选择公开/私有；普通用户强制私有（仅自己可见）
  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const lr = (dbUser?.is_admin) ? (login_required ? 1 : 0) : 1

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM folders WHERE user_id = ?').get(user.id) as { m: number | null } | undefined
  const result = db.prepare(
    'INSERT INTO folders (user_id, name, parent_id, sort_order, login_required, icon) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(user.id, name, parent_id || null, (maxOrder?.m || 0) + 1, lr, icon || null)

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid)
  return { folder }
})
