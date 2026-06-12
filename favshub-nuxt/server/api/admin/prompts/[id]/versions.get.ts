/**
 * GET /api/admin/prompts/:id/versions — 获取提示词版本历史（管理员）
 */
import { getRawDb } from '../../../../database'
import { requireAuth } from '../../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '无效的提示词 ID' } })
  }

  const versions = db.prepare(`
    SELECT pv.* FROM prompt_versions pv
    WHERE pv.prompt_id = ? ORDER BY pv.created_at DESC
  `).all(id)

  return { versions }
})
