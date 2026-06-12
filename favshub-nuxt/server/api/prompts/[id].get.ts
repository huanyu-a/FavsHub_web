/**
 * GET /api/prompts/:id — 获取单个提示词（含标签和版本）
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const { id } = getRouterParams(event)

  const db = getRawDb()

  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }

  // 可见性检查
  // 管理员：全部
  // 普通用户：自己的 + 管理员公开的
  // 游客：管理员的公开提示词
  const isOwnerAdmin = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(prompt.user_id) as { is_admin: number } | undefined
  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser?.is_admin) {
      // 管理员可以看全部
    } else if (prompt.user_id === user.id) {
      // 自己的
    } else if (isOwnerAdmin?.is_admin && !prompt.login_required) {
      // 管理员公开的
    } else {
      throw createError({ statusCode: 403, data: { error: '无权访问此提示词' } })
    }
  } else {
    if (!isOwnerAdmin?.is_admin || prompt.login_required) {
      throw createError({ statusCode: 403, data: { error: '无权访问此提示词' } })
    }
  }

  // 获取标签
  const tags = db.prepare(`
    SELECT t.id, t.name, t.color FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = ?
  `).all(id)

  // 获取版本列表
  const versions = db.prepare(`
    SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC
  `).all(id)

  prompt.prompt_id = prompt.id
  prompt.tags = tags
  prompt.versions = versions

  return { prompt }
})
