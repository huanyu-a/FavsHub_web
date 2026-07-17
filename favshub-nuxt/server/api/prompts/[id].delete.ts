/**
 * DELETE /api/prompts/:id — 软删除提示词（移入回收站）
 * Query: ?permanent=1 → 物理删除（从回收站清除）
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const query = getQuery(event)
  const permanent = query.permanent === '1' || query.permanent === 'true'

  const db = getRawDb()

  // 验证归属
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }
  if (prompt.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权删除此提示词' } })
  }

  if (permanent) {
    // 物理删除（级联清除 tags/versions）
    db.prepare('DELETE FROM prompts WHERE id = ?').run(id)
  } else {
    // 软删除
    db.prepare('UPDATE prompts SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
  }

  return { success: true, permanent: !!permanent }
})
