/**
 * GET /api/auth/me — 获取当前用户信息
 * 移植自 wwwroot/server/routes/auth.js
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler((event) => {
  const authUser = requireAuth(event)
  const db = getRawDb()

  const user = db.prepare(
    'SELECT id, username, email, nickname, is_admin, created_at FROM users WHERE id = ?'
  ).get(authUser.id) as {
    id: number; username: string; email: string | null;
    nickname: string | null; is_admin: number; created_at: number
  } | undefined

  if (!user) {
    throw createError({ statusCode: 404, data: { error: '用户不存在' } })
  }

  return { user }
})
