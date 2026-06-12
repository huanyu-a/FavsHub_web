/**
 * PUT /api/admin/prompts/:id — 更新提示词（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '无效的提示词 ID' } })
  }

  const prompt = db.prepare('SELECT id FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
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
  if (login_required !== undefined) {
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
