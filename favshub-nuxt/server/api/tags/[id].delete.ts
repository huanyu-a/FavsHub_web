/**
 * DELETE /api/tags/:id — 删除标签
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)

  const db = getRawDb()

  // 验证标签归属
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as any
  if (!tag) {
    throw createError({ statusCode: 404, data: { error: '标签不存在' } })
  }
  if (tag.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权删除此标签' } })
  }

  // 删除标签（prompt_tags 的关联因外键级联删除）
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)

  return { success: true }
})
