/**
 * DELETE /api/admin/prompts/:id — 删除提示词（管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '无效的提示词 ID' } })
  }

  const prompt = db.prepare('SELECT id FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?').run(id)
    db.prepare('DELETE FROM prompt_versions WHERE prompt_id = ?').run(id)
    db.prepare('DELETE FROM prompts WHERE id = ?').run(id)
  })
  tx()

  return { success: true, message: '已删除提示词' }
})
