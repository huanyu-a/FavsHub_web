/**
 * GET /api/settings/default — 获取当前用户的个人设置
 * 每个登录用户读取自己的设置，互不影响
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler((event) => {
  const authUser = requireAuth(event)
  const db = getRawDb()

  const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(authUser.id) as { data: string } | undefined
  let settings: Record<string, any> = {}
  try {
    settings = row ? JSON.parse(row.data) : {}
  } catch { /* ignore */ }

  return { data: settings }
})