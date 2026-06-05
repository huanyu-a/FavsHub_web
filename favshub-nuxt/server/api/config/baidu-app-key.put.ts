/**
 * PUT /api/config/baidu-app-key — 更新百度 App Key（仅管理员）
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event) // 仅管理员可访问
  const body = await readBody(event)
  const { key } = body || {}

  if (typeof key !== 'string') {
    throw createError({ statusCode: 400, data: { error: '请求体必须包含 key 字符串' } })
  }

  const db = getRawDb()

  // 获取现有系统设置
  const row = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as { data: string } | undefined
  let settings: Record<string, any> = {}
  try {
    settings = row ? JSON.parse(row.data) : {}
  } catch { /* ignore */ }

  // 更新 baiduAppKey
  settings.baiduAppKey = key

  // UPSERT
  db.prepare(`
    INSERT INTO settings (user_id, data) VALUES (0, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data
  `).run(JSON.stringify(settings))

  return { success: true }
})