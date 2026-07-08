/**
 * POST /api/auth/login — 登录
 */
import bcrypt from 'bcryptjs'
import { getRawDb } from '../../database'
import { signToken } from '../../utils/jwt'
import { checkRateLimit, recordFailedLogin, clearFailedLogin, getClientIP } from '../../utils/rate-limit'
import { getConfigInt } from '../../utils/config'

export default defineEventHandler(async (event) => {
  // IP 级限频（防止单 IP 暴力扫描多账户）
  const ip = getClientIP(event)
  checkRateLimit(`login:${ip}`, getConfigInt('rate_limit_login_max', 20), getConfigInt('rate_limit_login_window', 60_000))

  const body = await readBody(event)
  const { username, password } = body || {}

  if (!username || !password) {
    throw createError({ statusCode: 400, data: { error: '用户名和密码不能为空' } })
  }

  // 用户名级限频（防止针对单账户的暴力破解 + 账户锁定）
  checkRateLimit(`login_user:${String(username).toLowerCase()}`, 10, 15 * 60 * 1000)

  const db = getRawDb()
  const user = db.prepare('SELECT id, username, email, password_hash, nickname, is_admin FROM users WHERE username = ?').get(username) as {
    id: number; username: string; email: string | null;
    password_hash: string; nickname: string | null; is_admin: number
  } | undefined

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    // 记录失败尝试，触发账户锁定
    if (user) {
      recordFailedLogin(user.username)
    }
    throw createError({ statusCode: 401, data: { error: '用户名或密码错误' } })
  }

  // 登录成功，清除失败记录
  clearFailedLogin(user.username)

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

  // 判断请求来源：浏览器扩展通过 Bearer token 认证，Web 页面通过 httpOnly cookie
  // 扩展请求通常不携带 Origin 头（或携带 chrome-extension:// Origin）
  const origin = getRequestHeader(event, 'origin') || ''
  const isExtensionRequest = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')

  const responseData: any = {
    user: { id: user.id, username: user.username, email: user.email, nickname: user.nickname || '', is_admin: !!user.is_admin },
  }

  // 仅对扩展请求返回 token；Web 端使用 httpOnly cookie，减少 XSS token 窃取风险
  if (isExtensionRequest) {
    responseData.token = token
  }

  return responseData
})
