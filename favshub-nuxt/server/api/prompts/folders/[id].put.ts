/**
 * PUT /api/prompts/folders/:id — 更新提示词文件夹
 * Body: { name?, parent_id?, icon? }
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)
  const { name, parent_id, icon } = body || {}

  const db = getRawDb()

  // 验证归属
  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }
  if (folder.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权修改此文件夹' } })
  }

  const updates: string[] = []
  const params: any[] = []

  if (name !== undefined && name.trim()) {
    updates.push('name = ?')
    params.push(name.trim())
  }
  if (parent_id !== undefined) {
    updates.push('parent_id = ?')
    params.push(parent_id || null)
  }
  if (icon !== undefined) {
    updates.push('icon = ?')
    params.push(icon)
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)
    db.prepare(`UPDATE prompt_folders SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  }

  const updated = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id) as any
  updated.folder_id = updated.id
  updated.folder_name = updated.name

  return { folder: updated }
})
