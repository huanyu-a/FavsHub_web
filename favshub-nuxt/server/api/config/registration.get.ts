/**
 * GET /api/config/registration — 检查是否允许注册（公开接口）
 */
import { getRawDb } from '../../database'

export default defineEventHandler(() => {
  const db = getRawDb()
  const row = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as any
  const settings = row ? JSON.parse(row.data) : {}
  return { allowed: settings.allow_registration !== false }
})
