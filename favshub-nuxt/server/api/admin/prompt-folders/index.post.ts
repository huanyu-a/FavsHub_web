/**
 * POST /api/admin/prompt-folders — 创建提示词文件夹（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { name, user_id, parent_id, icon } = body

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
    const parent = db.prepare('SELECT id FROM prompt_folders WHERE id = ? AND user_id = ?').get(parent_id, user_id) as any
    if (!parent) {
      throw createError({ statusCode: 404, data: { error: '父文件夹不存在' } })
    }
  }

  const now = Date.now()
  const id = now.toString() + Math.random().toString(36).slice(2, 6)
  db.prepare('INSERT INTO prompt_folders (id, user_id, name, parent_id, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    user_id,
    name,
    parent_id || null,
    icon || '',
    now,
    now
  )

  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id)
  return { folder }
})
