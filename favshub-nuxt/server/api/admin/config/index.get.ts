/**
 * GET /api/admin/config — 读取系统配置
 */
import { requireAdmin } from '../../../utils/auth'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const config = useRuntimeConfig(event)
  const adminUsers = (config.adminUsers || '').split(',').map((u: string) => u.trim()).filter(Boolean)
  const dbPath = config.dbPath || join(process.cwd(), 'data', 'favshub.db')

  return {
    adminUsers,
    jwtSecret: config.jwtSecret ? '已设置（环境变量）' : '使用默认值',
    port: config.port || 3000,
    dbPath
  }
})
