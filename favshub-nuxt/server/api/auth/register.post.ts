/**
 * POST /api/auth/register — 注册
 */
import bcrypt from 'bcryptjs'
import { getRawDb } from '../../database'
import { signToken } from '../../utils/jwt'
import { checkRateLimit } from '../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  checkRateLimit(`register:${ip}`, 10, 60_000)
  const body = await readBody(event)
  const { username, password, email, nickname } = body || {}

  // 校验
  if (!username || !password) {
    throw createError({ statusCode: 400, data: { error: '用户名和密码不能为空' } })
  }
  if (username.length < 2 || username.length > 32) {
    throw createError({ statusCode: 400, data: { error: '用户名长度 2-32 字符' } })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, data: { error: '密码至少 8 位' } })
  }
  if (nickname && nickname.length > 64) {
    throw createError({ statusCode: 400, data: { error: '昵称最长 64 字符' } })
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, data: { error: '邮箱格式不正确' } })
  }

  const db = getRawDb()

  // 检查是否允许注册
  const settingRow = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as any
  const sysSettings = settingRow ? JSON.parse(settingRow.data) : {}
  if (sysSettings.allow_registration === false) {
    throw createError({ statusCode: 403, data: { error: '注册功能已关闭，请联系管理员' } })
  }

  // 检查用户名是否已存在（模糊错误信息防止用户名枚举）
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) {
    throw createError({ statusCode: 409, data: { error: '注册失败，请更换用户名或稍后重试' } })
  }

  // 第一个注册用户自动成为管理员（排除系统用户 id=0）
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users WHERE id > 0').get() as { c: number }).c
  const isAdmin = userCount === 0 ? 1 : 0

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
  setCookie(event, 'favshub_token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  })

  return {
    token,
    user: { id: userId, username, email: email || null, nickname: nickname || '', is_admin: !!isAdmin },
  }
})
