/**
 * GET /api/prompts/versions/:promptId — 获取提示词版本列表
 */
import { getRawDb } from '../../../database'
import { optionalAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const { promptId } = getRouterParams(event)

  const db = getRawDb()

  // 验证 prompt 存在
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }

  // 可见性检查
  if (prompt.login_required && !user) {
    throw createError({ statusCode: 403, data: { error: '无权访问此提示词' } })
  }
  if (prompt.login_required && user && user.id !== prompt.user_id) {
    const isAdmin = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (!isAdmin?.is_admin) {
      throw createError({ statusCode: 403, data: { error: '无权访问此提示词' } })
    }
  }

  const versions = db.prepare(`
    SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC
  `).all(promptId)

  return { versions }
})
