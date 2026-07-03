/**
 * POST /api/admin/prompt-folders — 创建提示词文件夹（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const auth = requireAdmin(event)
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
    const parent = db.prepare('SELECT id FROM prompt_folders WHERE id = ? AND user_id = ?').get(parent_id, ownerId) as any
    if (!parent) {
      throw createError({ statusCode: 404, data: { error: '父文件夹不存在' } })
    }
  }

  const now = Date.now()
  const id = now.toString() + Math.random().toString(36).slice(2, 6)

  // Auto-calculate sort_order if not provided
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
    login_required ? 1 : 0,
    now,
    now
  )

  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id)
  return { folder }
})
