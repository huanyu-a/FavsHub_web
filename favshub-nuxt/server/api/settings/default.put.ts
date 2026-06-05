/**
 * PUT /api/settings/default — 更新管理员默认设置（仅管理员）
 * Body: { data: { ... } }
 * 直接覆盖系统设置（user_id=0），不进行合并
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event) // 仅管理员可访问
  const body = await readBody(event)
  const { data } = body || {}

  if (!data || typeof data !== 'object') {
    throw createError({ statusCode: 400, data: { error: '请求体必须包含 data 对象' } })
  }

  const db = getRawDb()

  // 直接覆盖系统设置
  const jsonStr = JSON.stringify(data)

  // UPSERT
  db.prepare(`
    INSERT INTO settings (user_id, data) VALUES (0, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data
  `).run(jsonStr)

  return { data }
})