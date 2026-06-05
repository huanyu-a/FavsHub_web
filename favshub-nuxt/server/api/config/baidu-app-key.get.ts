/**
 * GET /api/config/baidu-app-key — 获取百度 App Key（仅认证用户）
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler((event) => {
  requireAuth(event) // 仅认证用户可访问
  const db = getRawDb()
  const row = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as { data: string } | undefined
  if (!row) return { key: '' }
  try {
    const settings = JSON.parse(row.data)
    return { key: settings.baiduAppKey || '' }
  } catch {
    return { key: '' }
  }
})