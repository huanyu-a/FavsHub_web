/**
 * GET /api/tags — 获取标签列表
 * 游客：管理员公开 prompts 的标签
 * 普通用户：仅自己的标签
 * 管理员：全部
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  let tags: any[]

  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser?.is_admin) {
      tags = db.prepare(`
        SELECT DISTINCT t.*, t.id as tag_id, t.name as tag_name
        FROM tags t
        ORDER BY t.name
      `).all()
    } else {
      tags = db.prepare(`
        SELECT DISTINCT t.*, t.id as tag_id, t.name as tag_name
        FROM tags t
        WHERE t.user_id = ?
        ORDER BY t.name
      `).all(user.id)
    }
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
