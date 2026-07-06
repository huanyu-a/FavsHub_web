/**
 * PUT /api/admin/prompts/:id — 更新提示词
 * 管理员：可更新任意提示词
 * 普通用户：仅可更新自己的提示词，且不能更改 login_required
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '无效的提示词 ID' } })
  }

  const prompt = db.prepare('SELECT id, user_id FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }

  if (!isAdmin && prompt.user_id !== auth.id) {
    throw createError({ statusCode: 403, data: { error: '无权限修改此提示词' } })
  }

  const body = await readBody(event)
  const { title, description, content, folder_id, login_required } = body

  const now = Date.now()
  if (title !== undefined) {
    db.prepare('UPDATE prompts SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id)
  }
  if (description !== undefined) {
    db.prepare('UPDATE prompts SET description = ?, updated_at = ? WHERE id = ?').run(description, now, id)
  }
  if (content !== undefined) {
    db.prepare('UPDATE prompts SET content = ?, updated_at = ? WHERE id = ?').run(content, now, id)
  }
  if (folder_id !== undefined) {
    db.prepare('UPDATE prompts SET folder_id = ?, updated_at = ? WHERE id = ?').run(folder_id || null, now, id)
  }
  // 只有管理员可修改可见性
  if (isAdmin && login_required !== undefined) {
    db.prepare('UPDATE prompts SET login_required = ?, updated_at = ? WHERE id = ?').run(login_required ? 1 : 0, now, id)
  }

  const updated = db.prepare(`
    SELECT p.*, u.username, pf.name as folder_name
    FROM prompts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN prompt_folders pf ON p.folder_id = pf.id
    WHERE p.id = ?
  `).get(id)

  return { prompt: updated }
})
