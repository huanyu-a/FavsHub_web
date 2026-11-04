/**
 * GET /api/auth/me — 获取当前用户信息
 */
import { getRawDb } from '../../database'
import { requireAuth, isAdminUser } from '../../utils/auth'
import { avatarUrl } from '../../utils/avatar'

export default defineEventHandler((event) => {
  const authUser = requireAuth(event)
  const db = getRawDb()

  const user = db.prepare(
    'SELECT id, username, email, nickname, is_admin, created_at, qq_cipher FROM users WHERE id = ?'
  ).get(authUser.id) as {
    id: number; username: string; email: string | null;
    nickname: string | null; is_admin: number; created_at: number;
    qq_cipher: string | null
  } | undefined

  if (!user) {
    throw createError({ statusCode: 404, data: { error: '用户不存在' } })
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      nickname: user.nickname,
      // 2026-11-04：改用 isAdminUser()，与 requireAdmin / isAdminUserById 同口径。
      // 此前只回数据库的 is_admin 列，忽略了 NUXT_ADMIN_USERS 名单 ——
      // 于是「名单型管理员」在前端被当作普通用户，所有管理员专属控件
      // （下拉、精选对比、状态选择…）都不渲染，而 API 却放行，前后端自相矛盾。
      is_admin: isAdminUser(user),
      created_at: user.created_at,
      // 只回头像 URL（加密令牌），绝不回 QQ 号本身
      avatar: avatarUrl(user.qq_cipher),
    },
  }
})
