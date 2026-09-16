/**
 * 服务端认证中间件 — Nuxt/H3 event-based
 */
import type { H3Event } from 'h3'
import { getHeader, getCookie, createError } from 'h3'
import { verifyToken, type JwtPayload } from './jwt'
import { getRawDb } from '../database'

export interface AuthUser extends JwtPayload {}

/**
 * 归一化管理员名单配置为字符串数组。
 *
 * 注意：Nuxt 会用 destr 反序列化 NUXT_ADMIN_USERS 环境变量，
 * 因此纯数字值（如 `NUXT_ADMIN_USERS=1`）会被解析成 number，
 * 纯 JSON 数组会被解析成 string[]，只有含逗号的普通字符串才保持 string。
 * 直接对该值调用 .split() 会抛 "split is not a function" 导致 500。
 */
export function parseAdminUsers(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (typeof value === 'string') return value.split(',').map(u => u.trim()).filter(Boolean)
  return []
}

/**
 * 从 H3 event 中提取 token 并验证
 * 优先级：Authorization header > httpOnly cookie
 * @returns 已验证的用户信息，或 null（无 token 时）
 */
function extractUser(event: H3Event): AuthUser | null {
  // 1. Authorization header（浏览器扩展优先方式）
  const header = getHeader(event, 'authorization')
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7)
    if (token) return verifyToken(token)
  }

  // 2. httpOnly cookie（Web 页面 fallback）
  const cookieToken = getCookie(event, 'favshub_token')
  if (cookieToken) return verifyToken(cookieToken)

  return null
}

/**
 * 必需认证 — 无 token 或无效 token 抛出 401
 */
export function requireAuth(event: H3Event): AuthUser {
  const user = extractUser(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未登录',
      data: { error: '未登录' },
    })
  }
  return user
}

/**
 * 可选认证 — 有 token 则解析，无 token 返回 null
 */
export function optionalAuth(event: H3Event): AuthUser | null {
  return extractUser(event)
}

/**
 * 管理员权限检查
 */
export function requireAdmin(event: H3Event): AuthUser {
  const user = requireAuth(event)

  // 1. 环境变量配置的管理员
  const config = useRuntimeConfig(event)
  const adminUsers = parseAdminUsers(config.adminUsers)
  if (adminUsers.includes(user.username)) {
    return user
  }

  // 2. 数据库 is_admin 字段
  const db = getRawDb()
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  if (row?.is_admin) {
    return user
  }

  throw createError({
    statusCode: 403,
    message: '无管理员权限',
    data: { error: '当前账号无管理员权限。请使用管理员账号登录，或设置 ADMIN_USERS 环境变量。' },
  })
}

/**
 * 获取当前用户的角色信息（不抛异常）
 * 用于需要根据角色返回不同数据的场景（如管理员看全局、普通用户看自己）
 */
export function getAuthRole(event: H3Event): { user: AuthUser; isAdmin: boolean } | null {
  const user = extractUser(event)
  if (!user) return null

  // 1. 环境变量配置的管理员
  const config = useRuntimeConfig(event)
  const adminUsers = parseAdminUsers(config.adminUsers)
  if (adminUsers.includes(user.username)) {
    return { user, isAdmin: true }
  }

  // 2. 数据库 is_admin 字段
  const db = getRawDb()
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  if (row?.is_admin) {
    return { user, isAdmin: true }
  }

  return { user, isAdmin: false }
}
