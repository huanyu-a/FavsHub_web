/**
 * GET /api/admin/users — 用户列表（含书签/Prompt 数量）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const db = getRawDb()

  const users = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.email, u.is_admin, u.created_at,
      (SELECT COUNT(*) FROM bookmarks WHERE user_id = u.id) as bookmark_count,
      (SELECT COUNT(*) FROM prompts WHERE user_id = u.id) as prompt_count
    FROM users u ORDER BY u.created_at DESC
  `).all()

  // 获取环境变量中配置的管理员用户
  const config = useRuntimeConfig(event)
  const adminUsers = (config.adminUsers || '').split(',').map((u: string) => u.trim()).filter(Boolean)

  return { users, adminUsers }
})
