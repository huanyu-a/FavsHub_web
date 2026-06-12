/**
 * POST /api/auth/login — 登录
 */
import bcrypt from 'bcryptjs'
import { getRawDb } from '../../database'
import { signToken } from '../../utils/jwt'
import { checkRateLimit } from '../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  checkRateLimit(`login:${ip}`, 20, 60_000)
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
  setCookie(event, 'favshub_token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  })

  return {
    token,
    user: { id: user.id, username: user.username, email: user.email, nickname: user.nickname || '', is_admin: !!user.is_admin },
  }
})
