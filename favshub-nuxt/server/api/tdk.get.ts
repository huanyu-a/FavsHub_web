/**
 * GET /api/tdk — 获取站点 TDK 配置（公开接口）
 * 从 system_config 表读取两套 TDK：首页(site*) 和 提示词页(promptpro*)
 */
import { getRawDb } from '../database'

export default defineEventHandler(() => {
  const db = getRawDb()

  // 从 system_config 表批量读取 TDK 字段
  const rows = db.prepare(
    `SELECT key, value FROM system_config WHERE key IN (
      'siteTitle', 'siteDescription', 'siteKeywords',
      'promptproTitle', 'promptproDescription', 'promptproKeywords'
    )`
  ).all() as { key: string; value: string }[]

  const config: Record<string, string> = {}
  for (const { key, value } of rows) {
    config[key] = value || ''
  }

  return {
    siteTitle: config.siteTitle || '',
    siteDescription: config.siteDescription || '',
    siteKeywords: config.siteKeywords || '',
    promptproTitle: config.promptproTitle || '',
    promptproDescription: config.promptproDescription || '',
    promptproKeywords: config.promptproKeywords || '',
  }
})