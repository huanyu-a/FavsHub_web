/**
 * DELETE /api/prompts/:id — 删除提示词
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)

  const db = getRawDb()

  // 验证归属
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }
  if (prompt.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权删除此提示词' } })
  }

  // 删除（prompt_tags 和 prompt_versions 因外键级联删除）
  db.prepare('DELETE FROM prompts WHERE id = ?').run(id)

  return { success: true }
})
