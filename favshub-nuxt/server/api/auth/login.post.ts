/**
 * POST /api/auth/login — 登录
 */
import bcrypt from 'bcryptjs'
import { getRawDb } from '../../database'
import { signToken } from '../../utils/jwt'
import { checkRateLimit } from '../../utils/rate-limit'
import { getConfigInt } from '../../utils/config'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  checkRateLimit(`login:${ip}`, getConfigInt('rate_limit_login_max', 20), getConfigInt('rate_limit_login_window', 60_000))
  const body = await readBody(event)
  const { username, password } = body || {}

  if (!username || !password) {
    throw createError({ statusCode: 400, data: { error: '用户名和密码不能为空' } })
  }

  const db = getRawDb()
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as {
    id: number; username: string; email: string | null;
    password_hash: string; nickname: string | null; is_admin: number
  } | undefined

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw createError({ statusCode: 401, data: { error: '用户名或密码错误' } })
  }

  const token = signToken({ id: user.id, username: user.username })

  // 服务端设置 httpOnly cookie（防止 XSS 读取）
  // secure 标志仅在 HTTPS 下启用，支持 HTTP 开发环境
  const isSecure = getRequestProtocol(event) === 'https'
  setCookie(event, 'favshub_token', token, {
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: getConfigInt('cookie_max_age', 60 * 60 * 24 * 7),
  })

  return {
    token,
    user: { id: user.id, username: user.username, email: user.email, nickname: user.nickname || '', is_admin: !!user.is_admin },
  }
})
