/**
 * 服务端中间件 — 保护 /admin 页面路由
 * 1. 验证 JWT token（未登录 → 302 跳转）
 * 2. 验证管理员角色（非管理员 → 302 跳转）
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
    // token 无效，清除 cookie 并跳转登录（secure 跟随当前协议）
    const isSecure = getRequestProtocol(event) === 'https'
    setCookie(event, 'favshub_token', '', { path: '/', maxAge: 0, httpOnly: true, secure: isSecure, sameSite: 'lax' })
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(path)}`, 302)
  }

  // 验证管理员角色
  const config = useRuntimeConfig(event)
  const adminUsers = (config.adminUsers || '').split(',').map((u: string) => u.trim()).filter(Boolean)
  // 1. 环境变量配置的管理员
  if (!adminUsers.includes(payload.username)) {
    // 2. 数据库 is_admin 字段
    const db = getRawDb()
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(payload.id) as { is_admin: number } | undefined
    if (!row?.is_admin) {
      // 非管理员 → 跳转首页
      return sendRedirect(event, '/', 302)
    }
  }
})
