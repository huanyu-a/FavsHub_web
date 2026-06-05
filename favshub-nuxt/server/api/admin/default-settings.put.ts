/**
 * PUT /api/admin/default-settings — 更新系统默认设置
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { data } = body

  if (!data || typeof data !== 'object') {
    throw createError({ statusCode: 400, data: { error: 'data 必须是对象' } })
  }

  const row = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as any
  const existing = row ? JSON.parse(row.data) : {}
  const merged = { ...existing, ...data }

  // Ensure system settings row exists
  db.prepare('INSERT OR IGNORE INTO settings (user_id, data) VALUES (0, ?)').run('{}')
  db.prepare('UPDATE settings SET data = ? WHERE user_id = 0').run(JSON.stringify(merged))

  return { data: merged }
})
