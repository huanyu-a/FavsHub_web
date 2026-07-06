/**
 * 服务端中间件 — 保护 /admin 页面路由
 * 仅验证 JWT token（未登录 → 302 跳转登录页）
 * 管理员专属功能由各 API 端点的 requireAdmin() 和前端 v-if 控制
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
    // token 无效，清除 cookie 并跳转登录（secure 跟随当前协议）
    const isSecure = getRequestProtocol(event) === 'https'
    setCookie(event, 'favshub_token', '', { path: '/', maxAge: 0, httpOnly: true, secure: isSecure, sameSite: 'lax' })
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(path)}`, 302)
  }

  // 不再检查 is_admin，任何登录用户均可访问 /admin 页面
})
