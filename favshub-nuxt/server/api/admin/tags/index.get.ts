/**
 * GET /api/admin/tags — 标签列表（含使用次数）
 * 所有人可见（管理员的标签对普通用户只读，前端控制）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const tags = db.prepare(`
    SELECT t.*, u.username,
      (SELECT COUNT(*) FROM prompt_tags WHERE tag_id = t.id) as prompt_count
    FROM tags t
    LEFT JOIN users u ON t.user_id = u.id
    ORDER BY t.name
  `).all()

  return { tags, isAdmin }
})
