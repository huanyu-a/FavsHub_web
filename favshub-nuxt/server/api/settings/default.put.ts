/**
 * PUT /api/settings/default — 更新当前用户的个人设置
 * Body: { data: { ... } }
 * 每个登录用户写入自己的设置，互不影响
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { SYSTEM_ONLY_KEYS } from '../../utils/constants'

export default defineEventHandler(async (event) => {
  const authUser = requireAuth(event)
  const body = await readBody(event)
  const { data } = body || {}

  if (!data || typeof data !== 'object') {
    throw createError({ statusCode: 400, data: { error: '请求体必须包含 data 对象' } })
  }

  const db = getRawDb()

  // 过滤系统级字段，普通用户不允许写入
  const filtered: Record<string, any> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!SYSTEM_ONLY_KEYS.includes(k)) {
      filtered[k] = v
    }
  }

  // 读取现有设置并合并
  const existingRow = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(authUser.id) as { data: string } | undefined
  const existing = existingRow ? JSON.parse(existingRow.data) : {}
  const merged = { ...existing, ...filtered }

  // UPSERT 当前用户设置
  db.prepare(`
    INSERT INTO settings (user_id, data) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data
  `).run(authUser.id, JSON.stringify(merged))

  return { data: merged }
})