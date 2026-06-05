/**
 * PUT /api/settings — 更新用户设置
 * Body: { data: { ... } }
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { data } = body || {}

  if (!data || typeof data !== 'object') {
    throw createError({ statusCode: 400, data: { error: '请求体必须包含 data 对象' } })
  }

  const db = getRawDb()

  // 获取现有用户设置
  const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(user.id) as { data: string } | undefined
  let existing: Record<string, any> = {}
  try {
    existing = row ? JSON.parse(row.data) : {}
  } catch { /* ignore */ }

  // 合并
  const merged = { ...existing, ...data }
  const jsonStr = JSON.stringify(merged)

  // UPSERT
  db.prepare(`
    INSERT INTO settings (user_id, data) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data
  `).run(user.id, jsonStr)

  return { data: merged }
})
