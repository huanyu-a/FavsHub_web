/**
 * PUT /api/auth/profile — 更新当前用户资料
 * 普通用户可修改自己的 nickname、email、password、qq（用于头像）
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { createError, readBody } from 'h3'
import bcrypt from 'bcryptjs'
import { getConfigInt } from '../../utils/config'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import { encryptQQ, isValidQQ, avatarUrl } from '../../utils/avatar'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { nickname, email, password, old_password, qq } = body

  // 修改密码需要验证旧密码 — 增加速率限制防止旧密码暴力破解
  if (password !== undefined && password) {
    const ip = getClientIP(event)
    checkRateLimit(`pwd_change:${ip}`, 5, 15 * 60 * 1000) // 15 分钟内最多 5 次
    if (!old_password) {
      throw createError({ statusCode: 400, data: { error: '请输入旧密码' } })
    }
    const dbUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string } | undefined
    if (!dbUser || !bcrypt.compareSync(old_password, dbUser.password_hash)) {
      throw createError({ statusCode: 400, data: { error: '旧密码错误' } })
    }
    if (password.length < getConfigInt('min_password_length', 8)) {
      throw createError({ statusCode: 400, data: { error: `新密码至少 ${getConfigInt('min_password_length', 8)} 位` } })
    }
    const hashedPassword = bcrypt.hashSync(password, 10)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashedPassword, user.id)
  }

  // 修改昵称
  if (nickname !== undefined) {
    if (nickname === null || nickname === '') {
      throw createError({ statusCode: 400, data: { error: '昵称不能为空' } })
    }
    if (nickname.length > 64) {
      throw createError({ statusCode: 400, data: { error: '昵称最长 64 字符' } })
    }
    db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, user.id)
  }

  // 修改邮箱
  if (email !== undefined) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw createError({ statusCode: 400, data: { error: '邮箱格式不正确' } })
    }
    // 检查邮箱是否已被其他用户使用
    if (email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, user.id) as any
      if (existing) {
        throw createError({ statusCode: 400, data: { error: '该邮箱已被其他用户使用' } })
      }
    }
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email || null, user.id)
  }

  // 修改 QQ 号（仅用于取头像）—— 存密文，绝不明文落库；空串表示清除头像
  if (qq !== undefined) {
    const qqRaw = String(qq ?? '').trim()
    if (!qqRaw) {
      db.prepare("UPDATE users SET qq_cipher = '' WHERE id = ?").run(user.id)
    } else {
      if (!isValidQQ(qqRaw)) {
        throw createError({ statusCode: 400, data: { error: 'QQ 号格式不正确（5-11 位数字）' } })
      }
      db.prepare('UPDATE users SET qq_cipher = ? WHERE id = ?').run(encryptQQ(qqRaw), user.id)
    }
  }

  // 返回更新后的用户信息
  const updated = db.prepare('SELECT id, username, email, nickname, is_admin, qq_cipher FROM users WHERE id = ?').get(user.id) as any
  return {
    user: {
      id: updated.id,
      username: updated.username,
      email: updated.email,
      nickname: updated.nickname || '',
      is_admin: !!updated.is_admin,
      // 只回头像 URL（加密令牌），绝不回 QQ 号本身
      avatar: avatarUrl(updated.qq_cipher),
    },
  }
})
