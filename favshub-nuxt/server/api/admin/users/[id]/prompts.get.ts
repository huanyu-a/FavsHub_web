/**
 * GET /api/admin/users/:id/prompts — 查看指定用户的提示词
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const userId = parseInt(id)
  if (isNaN(userId)) {
    throw createError({ statusCode: 400, data: { error: '无效的用户 ID' } })
  }

  const prompts = db.prepare(`
    SELECT p.*, pf.name as folder_name FROM prompts p
    LEFT JOIN prompt_folders pf ON p.folder_id = pf.id
    WHERE p.user_id = ? ORDER BY p.updated_at DESC
  `).all(userId)

  return { prompts }
})
