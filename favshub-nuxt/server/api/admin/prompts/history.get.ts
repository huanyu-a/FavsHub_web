/**
 * GET /api/admin/prompts/history — 提示词版本历史
 * 所有用户仅返回自己的提示词版本历史
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { getQuery, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()
  const query = getQuery(event)

  const limit = Math.min(200, Math.max(1, Number(query.limit) || 100))

  const versions = db.prepare(`
    SELECT pv.*, p.title as prompt_title, u.username
    FROM prompt_versions pv
    LEFT JOIN prompts p ON pv.prompt_id = p.id
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ?
    ORDER BY pv.created_at DESC
    LIMIT ?
  `).all(user.id, limit)

  return { versions }
})
