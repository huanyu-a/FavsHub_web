/**
 * GET /api/prompts/tag-relations — 获取 prompt-tag 关联关系
 * 普通用户：仅自己的关联
 * 管理员：全部
 * 游客：管理员公开关联
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  let relations: any[]

  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser?.is_admin) {
      relations = db.prepare(`SELECT pt.* FROM prompt_tags pt`).all()
    } else {
      relations = db.prepare(`
        SELECT pt.*
        FROM prompt_tags pt
        INNER JOIN prompts p ON pt.prompt_id = p.id
        WHERE p.user_id = ?
      `).all(user.id)
    }
  } else {
    // 游客：管理员公开关联
    relations = db.prepare(`
      SELECT pt.*
      FROM prompt_tags pt
      INNER JOIN prompts p ON pt.prompt_id = p.id
      WHERE p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)
    `).all()
  }

  return { relations }
})
