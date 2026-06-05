/**
 * GET /api/settings/default — 获取管理员默认设置（仅管理员）
 * 返回原始系统设置（user_id=0），不进行敏感字段过滤
 * 用于管理员设置页面查看/编辑所有设置，包括 baiduAppKey
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event) // 仅管理员可访问
  const db = getRawDb()

  // 获取系统设置 (user_id = 0)
  const row = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as { data: string } | undefined
  let settings: Record<string, any> = {}
  try {
    settings = row ? JSON.parse(row.data) : {}
  } catch { /* ignore */ }

  return { data: settings }
})