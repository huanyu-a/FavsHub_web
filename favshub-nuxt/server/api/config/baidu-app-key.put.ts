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
  db.prepare(
    'INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)'
  ).run('baiduAppKey', key, Date.now())

  return { success: true }
})
