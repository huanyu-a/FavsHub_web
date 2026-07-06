/**
 * GET /api/admin/tags — 标签列表
 * 所有用户仅返回自己使用的标签（通过自己的提示词关联）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const tags = db.prepare(`
    SELECT t.*, u.username,
      (SELECT COUNT(*) FROM prompt_tags pt2 WHERE pt2.tag_id = t.id) as prompt_count
    FROM tags t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE t.id IN (
      SELECT DISTINCT pt.tag_id
      FROM prompt_tags pt
      JOIN prompts p ON pt.prompt_id = p.id
      WHERE p.user_id = ?
    )
    ORDER BY t.name
  `).all(auth.id)

  return { tags }
})
