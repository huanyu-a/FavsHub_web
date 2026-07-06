/**
 * POST /api/admin/prompt-folders — 创建提示词文件夹
 * 管理员：可创建任意用户的文件夹，可设置 login_required
 * 普通用户：仅可创建自己的文件夹，且强制 login_required=1
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

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
    const parent = db.prepare('SELECT id FROM prompt_folders WHERE id = ? AND user_id = ?').get(parent_id, ownerId) as any
    if (!parent) {
      throw createError({ statusCode: 404, data: { error: '父文件夹不存在' } })
    }
  }

  const now = Date.now()
  const id = now.toString() + Math.random().toString(36).slice(2, 6)

  let finalSortOrder = sort_order
  if (finalSortOrder === undefined) {
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM prompt_folders WHERE user_id = ?').get(ownerId) as any
    finalSortOrder = (maxOrder?.m || 0) + 1
  }

  db.prepare('INSERT INTO prompt_folders (id, user_id, name, parent_id, icon, sort_order, login_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    ownerId,
    name,
    parent_id || null,
    icon || '',
    finalSortOrder,
    finalLoginRequired,
    now,
    now
  )

  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id)
  return { folder }
})
