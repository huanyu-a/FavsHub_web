/**
 * GET /api/admin/default-settings — 获取系统默认设置（user_id=0）
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const row = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as any
  return { data: row ? JSON.parse(row.data) : {} }
})
