/**
 * PUT /api/tags/:id — 更新标签
 * 普通用户禁止修改，仅管理员可操作
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)
  const { name, color } = body || {}

  const db = getRawDb()

  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as any
  if (!tag) {
    throw createError({ statusCode: 404, data: { error: '标签不存在' } })
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
