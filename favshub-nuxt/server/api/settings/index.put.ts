/**
 * PUT /api/settings — 更新用户设置
 * Body: { data: { ... } }
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { SYSTEM_ONLY_KEYS } from '../../utils/constants'
import { invalidateUserSettingsCache } from '../../utils/settings-cache'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { data } = body || {}

  if (!data || typeof data !== 'object') {
    throw createError({ statusCode: 400, data: { error: '请求体必须包含 data 对象' } })
  }

  // 过滤系统级字段，普通用户不允许写入
  const filtered: Record<string, any> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!SYSTEM_ONLY_KEYS.includes(k)) {
      filtered[k] = v
    }
  }

  const db = getRawDb()

  // 获取现有用户设置
  const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(user.id) as { data: string } | undefined
  let existing: Record<string, any> = {}
  try {
    existing = row ? JSON.parse(row.data) : {}
  } catch { /* ignore */ }

  // 合并
  const merged = { ...existing, ...filtered }
  const jsonStr = JSON.stringify(merged)

  // UPSERT
  db.prepare(`
    INSERT INTO settings (user_id, data) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data
  `).run(user.id, jsonStr)

  // 使 search-engines 等端点的设置解析缓存失效
  invalidateUserSettingsCache(user.id)

  return { data: merged }
})
