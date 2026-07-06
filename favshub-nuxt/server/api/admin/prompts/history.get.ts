/**
 * GET /api/admin/prompts/history — 提示词版本历史
 * 管理员：全部
 * 普通用户：仅自己的
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()
  const query = getQuery(event)

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const limit = Math.min(200, Math.max(1, Number(query.limit) || 100))

  const versions = isAdmin
    ? db.prepare(`
        SELECT pv.*, p.title as prompt_title, u.username
        FROM prompt_versions pv
        LEFT JOIN prompts p ON pv.prompt_id = p.id
        LEFT JOIN users u ON p.user_id = u.id
        ORDER BY pv.created_at DESC
        LIMIT ?
      `).all(limit)
    : db.prepare(`
        SELECT pv.*, p.title as prompt_title, u.username
        FROM prompt_versions pv
        LEFT JOIN prompts p ON pv.prompt_id = p.id
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.user_id = ?
        ORDER BY pv.created_at DESC
        LIMIT ?
      `).all(user.id, limit)

  return { versions, isAdmin }
})
