/**
 * PUT /api/tags/:id — 更新标签
 * Body: { name?, color? }
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)
  const { name, color } = body || {}

  const db = getRawDb()

  // 验证标签归属
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as any
  if (!tag) {
    throw createError({ statusCode: 404, data: { error: '标签不存在' } })
  }
  if (tag.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权修改此标签' } })
  }

  // 检查名称唯一性
  if (name && name.trim() && name.trim() !== tag.name) {
    const dup = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ? AND id != ?').get(user.id, name.trim(), id)
    if (dup) {
      throw createError({ statusCode: 409, data: { error: '同名标签已存在' } })
    }
  }

  const updates: string[] = []
  const params: any[] = []

  if (name !== undefined && name.trim()) {
    updates.push('name = ?')
    params.push(name.trim())
  }
  if (color !== undefined) {
    updates.push('color = ?')
    params.push(color)
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)
    db.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  }

  const updated = db.prepare('SELECT *, id as tag_id, name as tag_name FROM tags WHERE id = ?').get(id)
  return { tag: updated }
})
