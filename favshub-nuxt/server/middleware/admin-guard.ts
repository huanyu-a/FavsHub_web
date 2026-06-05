/**
 * 服务端中间件 — 保护 /admin 页面路由
 * 检查 cookie 中的 JWT token，未登录或非管理员则 302 跳转
 */
import { verifyToken } from '../utils/jwt'
import { getRawDb } from '../database'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  // 仅拦截 /admin 页面请求（排除 /api/ 和静态资源）
  if (!path.startsWith('/admin') || path.startsWith('/api/')) return

  // 从 cookie 读取 token
  const token = getCookie(event, 'favshub_token')
  if (!token) {
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(path)}`, 302)
  }

  // 验证 JWT
  const payload = verifyToken(token)
  if (!payload) {
    // token 无效，清除 cookie 并跳转登录
    setCookie(event, 'favshub_token', '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' })
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(path)}`, 302)
  }

  // 检查管理员权限
  const config = useRuntimeConfig(event)
  const adminUsers = (config.adminUsers || '').split(',').map(u => u.trim()).filter(Boolean)
  if (adminUsers.includes(payload.username)) return

  const db = getRawDb()
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(payload.id) as { is_admin: number } | undefined
  if (row?.is_admin) return

  // 非管理员
  return sendRedirect(event, '/', 302)
})
