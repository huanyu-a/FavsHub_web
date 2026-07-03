/**
 * GET /api/admin/backup-schedule — 获取备份配置
 */
import { requireAdmin } from '../../utils/auth'
import { getConfig, getConfigInt } from '../../utils/config'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  // 获取上次备份日期
  let lastBackupDate: string | null = null
  try {
    const backupDir = join(process.cwd(), 'data', 'backups')
    if (existsSync(backupDir)) {
      const files = readdirSync(backupDir).filter(f => f.startsWith('auto-backup-')).sort()
      if (files.length > 0) {
        const latest = files[files.length - 1]
        const dateMatch = latest.match(/auto-backup-(\d{4}-\d{2}-\d{2})/)
        if (dateMatch) lastBackupDate = dateMatch[1]
      }
    }
  } catch {}

  return {
    enabled: getConfig('backup_enabled') === 'true',
    hour: getConfigInt('backup_hour', 3),
    minute: getConfigInt('backup_minute', 0),
    keepCopies: getConfigInt('backup_keep_copies', 7),
    lastBackupDate,
  }
})
