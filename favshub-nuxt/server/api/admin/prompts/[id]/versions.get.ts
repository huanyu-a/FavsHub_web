/**
 * GET /api/admin/prompts/:id/versions — 获取提示词版本历史
 * 管理员：可查看任意提示词的版本历史
 * 普通用户：仅可查看自己的提示词的版本历史
 */
import { getRawDb } from '../../../../database'
import { requireAuth } from '../../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '无效的提示词 ID' } })
  }

  // 归属校验：非管理员只能查看自己的提示词
  if (!isAdmin) {
    const prompt = db.prepare('SELECT user_id FROM prompts WHERE id = ?').get(id) as { user_id: number } | undefined
    if (!prompt) {
      throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
    }
    if (prompt.user_id !== auth.id) {
      throw createError({ statusCode: 403, data: { error: '无权限查看此提示词的版本历史' } })
    }
  }

  const versions = db.prepare(`
    SELECT pv.* FROM prompt_versions pv
    WHERE pv.prompt_id = ? ORDER BY pv.created_at DESC
  `).all(id)

  return { versions, isAdmin }
})