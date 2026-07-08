/**
 * GET /api/admin/prompts/:id — 获取单个提示词详情
 * 管理员可查看任意提示词（用于审核对比），普通用户仅查看自己的
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

  const prompt = isAdmin
    ? db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
    : db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(id, auth.id) as any

  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }

  // 获取标签
  const tags = db.prepare(`
    SELECT t.id, t.name, t.color FROM prompt_tags pt
    JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = ?
  `).all(id)
  prompt.tags = tags

  return { prompt }
})
