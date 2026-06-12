/**
 * 服务端中间件 — 保护 /admin 页面路由
 * 检查 cookie 中的 JWT token，未登录则 302 跳转
 */
import { verifyToken } from '../utils/jwt'

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

  // 已登录即可访问
})
