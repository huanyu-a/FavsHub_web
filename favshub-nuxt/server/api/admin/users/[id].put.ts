/**
 * PUT /api/admin/users/:id — 更新用户
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const userId = parseInt(id)
  if (isNaN(userId)) {
    throw createError({ statusCode: 400, data: { error: '无效的用户 ID' } })
  }

  const body = await readBody(event)
  const { username, email, nickname, is_admin, password } = body

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as any
  if (!user) {
    throw createError({ statusCode: 404, data: { error: '用户不存在' } })
  }

  if (username !== undefined) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId) as any
    if (existing) {
      throw createError({ statusCode: 400, data: { error: '用户名已存在' } })
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, userId)
  }
  if (email !== undefined) {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId)
  }
  if (nickname !== undefined) {
    db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, userId)
  }
  if (is_admin !== undefined) {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin, userId)
  }
  if (password !== undefined && password) {
    const bcrypt = require('bcryptjs')
    const hashedPassword = bcrypt.hashSync(password, 10)
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId)
  }

  return { success: true }
})
