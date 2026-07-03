/**
 * GET /api/admin/tags — 标签列表（含使用次数，仅管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const tags = db.prepare(`
    SELECT t.*, u.username,
      (SELECT COUNT(*) FROM prompt_tags WHERE tag_id = t.id) as prompt_count
    FROM tags t
    LEFT JOIN users u ON t.user_id = u.id
    ORDER BY t.name
  `).all()

  return { tags, isAdmin: true }
})
