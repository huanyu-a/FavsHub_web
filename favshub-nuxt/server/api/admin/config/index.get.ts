/**
 * GET /api/admin/config — 读取系统配置
 */
import { requireAdmin } from '../../../utils/auth'
import { getRawDb } from '../../../database'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const config = useRuntimeConfig(event)

  const adminUsers = (config.adminUsers || '').split(',').map((u: string) => u.trim()).filter(Boolean)
  const dbPath = config.dbPath || join(process.cwd(), 'data', 'favshub.db')

  // 从 system_config 表读取系统级配置
  const db = getRawDb()
  const rows = db.prepare('SELECT key, value FROM system_config').all() as { key: string; value: string }[]
  const systemData: Record<string, string> = {}
  for (const { key, value } of rows) {
    systemData[key] = value
  }

  return {
    adminUsers,
    jwtSecret: config.jwtSecret ? '已设置（环境变量）' : '使用默认值',
    port: config.port || 3000,
    dbPath,
    nodeVersion: process.version,
    platform: process.platform,
    corsOrigin: config.corsOrigin || '*',
    uptime: formatUptime(process.uptime()),
    systemData,
  }
})

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}天`)
  if (h > 0) parts.push(`${h}小时`)
  parts.push(`${m}分钟`)
  return parts.join(' ')
}
