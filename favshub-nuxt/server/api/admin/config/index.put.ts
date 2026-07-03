/**
 * PUT /api/admin/config — 更新系统配置
 * 写入 system_config 表（键值对存储），仅管理员可操作
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { invalidateTdkCache } from '../../tdk.get'
import { SYSTEM_ONLY_KEYS } from '../../../utils/constants'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { data } = body

  if (!data || typeof data !== 'object') {
    throw createError({ statusCode: 400, data: { error: 'data 必须是对象' } })
  }

  // 逐个 key 写入 system_config 表（UPSERT）— 仅允许白名单中的 key
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)'
  )
  const now = Date.now()
  for (const [key, value] of Object.entries(data)) {
    // 仅允许写入预定义的系统配置 key，防止写入任意键
    if (!SYSTEM_ONLY_KEYS.includes(key)) continue
    upsert.run(key, String(value ?? ''), now)
  }

  // TDK 数据可能已变更，清除缓存
  invalidateTdkCache()

  // 返回更新后的全量配置
  const rows = db.prepare('SELECT key, value FROM system_config').all() as { key: string; value: string }[]
  const merged: Record<string, string> = {}
  for (const { key, value } of rows) {
    merged[key] = value
  }

  return { data: merged }
})
