/**
 * GET /api/prompts/tag-relations — 获取 prompt-tag 关联关系
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  let relations: any[]

  if (user) {
    // 登录用户：自己的关联 + 管理员公开关联
    relations = db.prepare(`
      SELECT pt.*
      FROM prompt_tags pt
      INNER JOIN prompts p ON pt.prompt_id = p.id
      WHERE p.user_id = ?
         OR (p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1))
    `).all(user.id)
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
