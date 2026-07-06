/**
 * DELETE /api/admin/prompts/:id — 删除提示词
 * 管理员：可删除任意提示词
 * 普通用户：仅可删除自己的提示词
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
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

  const prompt = db.prepare('SELECT id, user_id FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }

  if (!isAdmin && prompt.user_id !== auth.id) {
    throw createError({ statusCode: 403, data: { error: '无权限删除此提示词' } })
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?').run(id)
    db.prepare('DELETE FROM prompt_versions WHERE prompt_id = ?').run(id)
    db.prepare('DELETE FROM prompts WHERE id = ?').run(id)
  })
  tx()

  return { success: true, message: '已删除提示词' }
})
