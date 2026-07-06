/**
 * GET /api/admin/tags — 标签列表
 * 管理员：全部标签
 * 普通用户：仅自己使用的标签
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const tags = isAdmin
    ? db.prepare(`
        SELECT t.*, u.username,
          (SELECT COUNT(*) FROM prompt_tags WHERE tag_id = t.id) as prompt_count
        FROM tags t
        LEFT JOIN users u ON t.user_id = u.id
        ORDER BY t.name
      `).all()
    : db.prepare(`
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

  return { tags, isAdmin }
})
