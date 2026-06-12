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

  // 可见性检查：普通用户只能查看自己提示词的版本
  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (!dbUser?.is_admin && prompt.user_id !== user.id) {
      throw createError({ statusCode: 403, data: { error: '无权访问此提示词' } })
    }
  } else {
    const isOwnerAdmin = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(prompt.user_id) as { is_admin: number } | undefined
    if (!isOwnerAdmin?.is_admin || prompt.login_required) {
      throw createError({ statusCode: 403, data: { error: '无权访问此提示词' } })
    }
  }

  const versions = db.prepare(`
    SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC
  `).all(promptId)

  return { versions }
})
