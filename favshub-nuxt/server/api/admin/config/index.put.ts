/**
 * PUT /api/admin/config — 更新系统配置
 * 写入 system_config 表（键值对存储），仅管理员可操作
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { data } = body

  if (!data || typeof data !== 'object') {
    throw createError({ statusCode: 400, data: { error: 'data 必须是对象' } })
  }

  // 逐个 key 写入 system_config 表（UPSERT）
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)'
  )
  const now = Date.now()
  for (const [key, value] of Object.entries(data)) {
    upsert.run(key, String(value ?? ''), now)
  }

  // 返回更新后的全量配置
  const rows = db.prepare('SELECT key, value FROM system_config').all() as { key: string; value: string }[]
  const merged: Record<string, string> = {}
  for (const { key, value } of rows) {
    merged[key] = value
  }

  return { data: merged }
})
