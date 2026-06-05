/**
 * GET /api/tdk — 获取站点 TDK 配置（公开接口）
 * 返回系统设置中的 title, description, keywords 供前端 useHead() 使用
 */
import { getRawDb } from '../database'

export default defineEventHandler(() => {
  const db = getRawDb()

  // 获取系统设置 (user_id = 0)
  const row = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as { data: string } | undefined
  let settings: Record<string, any> = {}
  try {
    settings = row ? JSON.parse(row.data) : {}
  } catch { /* ignore */ }

  // 提取 TDK 字段
  return {
    title: settings.title || '',
    description: settings.description || '',
    keywords: settings.keywords || ''
  }
})