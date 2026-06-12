/**
 * GET /api/admin/tags — 获取所有标签（管理员视图，含使用次数）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const db = getRawDb()

  const tags = db.prepare(`
    SELECT t.*, u.username,
      (SELECT COUNT(*) FROM prompt_tags WHERE tag_id = t.id) as prompt_count
    FROM tags t
    LEFT JOIN users u ON t.user_id = u.id
    ORDER BY t.name
  `).all()

  return { tags }
})
