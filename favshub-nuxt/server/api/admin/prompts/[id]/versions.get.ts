/**
 * GET /api/admin/prompts/:id/versions — 获取提示词版本历史
 * 所有用户仅可查看自己的提示词的版本历史
 */
import { getRawDb } from '../../../../database'
import { getAuthRole } from '../../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '无效的提示词 ID' } })
  }

  // 归属校验：只能查看自己的提示词
  const prompt = db.prepare('SELECT user_id FROM prompts WHERE id = ?').get(id) as { user_id: number } | undefined
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }
  if (prompt.user_id !== auth.id) {
    throw createError({ statusCode: 403, data: { error: '无权限查看此提示词的版本历史' } })
  }

  const versions = db.prepare(`
    SELECT pv.* FROM prompt_versions pv
    WHERE pv.prompt_id = ? ORDER BY pv.created_at DESC
  `).all(id)

  return { versions }
})
