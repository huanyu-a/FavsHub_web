/**
 * GET /api/tags — 获取标签列表
 * 游客：管理员公开 prompts 的标签
 * 登录用户：自己的标签 UNION 管理员公开标签
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  let tags: any[]

  if (user) {
    // 登录：自己的标签 UNION 管理员公开标签
    tags = db.prepare(`
      SELECT DISTINCT t.*, t.id as tag_id, t.name as tag_name
      FROM tags t
      WHERE t.user_id = ?
         OR t.id IN (
            SELECT pt.tag_id FROM prompt_tags pt
            JOIN prompts p ON pt.prompt_id = p.id
            WHERE p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)
         )
         OR t.user_id IN (SELECT id FROM users WHERE is_admin = 1)
      ORDER BY t.name
    `).all(user.id)
  } else {
    // 游客：管理员公开 prompts 的标签
    tags = db.prepare(`
      SELECT DISTINCT t.*, t.id as tag_id, t.name as tag_name
      FROM tags t
      INNER JOIN prompt_tags pt ON t.id = pt.tag_id
      INNER JOIN prompts p ON pt.prompt_id = p.id
      WHERE p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)
      ORDER BY t.name
    `).all()
  }

  return { tags }
})
