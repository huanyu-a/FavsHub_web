/**
 * POST /api/auth/register — 注册
 */
import bcrypt from 'bcryptjs'
import { getRawDb } from '../../database'
import { signToken } from '../../utils/jwt'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import { getConfigInt, getConfig } from '../../utils/config'

export default defineEventHandler(async (event) => {
  const ip = getClientIP(event)
  checkRateLimit(`register:${ip}`, getConfigInt('rate_limit_register_max', 10), getConfigInt('rate_limit_register_window', 60_000))

  const body = await readBody(event)
  const { username, password, email, nickname } = body || {}

  // 校验
  if (!username || !password) {
    throw createError({ statusCode: 400, data: { error: '用户名和密码不能为空' } })
  }
  if (username.length < 2 || username.length > 32) {
    throw createError({ statusCode: 400, data: { error: '用户名长度 2-32 字符' } })
  }
  if (password.length < getConfigInt('min_password_length', 8)) {
    throw createError({ statusCode: 400, data: { error: `密码至少 ${getConfigInt('min_password_length', 8)} 位` } })
  }
  if (nickname && nickname.length > 64) {
    throw createError({ statusCode: 400, data: { error: '昵称最长 64 字符' } })
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, data: { error: '邮箱格式不正确' } })
  }

  const db = getRawDb()

  // 检查是否允许注册（从 system_config 读取）
  if (getConfig('allow_registration') === 'false') {
    throw createError({ statusCode: 403, data: { error: '注册功能已关闭，请联系管理员' } })
  }

  // 检查用户名是否已存在（模糊错误信息防止用户名枚举）
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) {
    throw createError({ statusCode: 409, data: { error: '注册失败，请更换用户名或稍后重试' } })
  }

  // 自助注册默认不授予管理员权限。
  // 仅当系统内不存在任何「可登录的管理员」时（兜底：预置管理员被误删，避免站点被锁死），
  // 才将首个注册者提升为管理员。排除 id=0 的 _system（password_hash 为空，无法登录）。
  const adminCount = (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 1 AND id > 0').get() as { c: number }).c
  const isAdmin = adminCount === 0 ? 1 : 0

  // 创建用户
  const hash = bcrypt.hashSync(password, 10)
  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash, is_admin, nickname) VALUES (?, ?, ?, ?, ?)'
  ).run(username, email || null, hash, isAdmin, nickname || '')

  const userId = Number(result.lastInsertRowid)

  // 初始化用户设置
  db.prepare('INSERT INTO settings (user_id, data) VALUES (?, ?)').run(userId, '{}')

  const token = signToken({ id: userId, username })

  // 服务端设置 httpOnly cookie（防止 XSS 读取）
  const isSecure = getRequestProtocol(event) === 'https'
  setCookie(event, 'favshub_token', token, {
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: getConfigInt('cookie_max_age', 60 * 60 * 24 * 7),
  })

  // 判断请求来源：扩展请求返回 token，Web 端使用 httpOnly cookie
  const origin = getRequestHeader(event, 'origin') || ''
  const isExtensionRequest = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')

  const responseData: any = {
    user: { id: userId, username, email: email || null, nickname: nickname || '', is_admin: !!isAdmin },
  }

  if (isExtensionRequest) {
    responseData.token = token
  }

  return responseData
})
