/**
 * GET /api/admin/backup-schedule — 获取备份配置
 */
import { requireAuth } from '../../utils/auth'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BACKUP_CONFIG_FILE = join(process.cwd(), 'data', '.backup-config.json')

const DEFAULT_CONFIG = {
  enabled: false,
  hour: 3,
  minute: 0,
  keepCopies: 7,
  lastBackupDate: null as string | null,
}

function loadBackupSchedule() {
  try {
    if (existsSync(BACKUP_CONFIG_FILE)) {
      const saved = JSON.parse(readFileSync(BACKUP_CONFIG_FILE, 'utf8'))
      return { ...DEFAULT_CONFIG, ...saved }
    }
  } catch { /* ignore */ }

  if (!DEFAULT_CONFIG.lastBackupDate) {
    try {
      const backupDir = join(process.cwd(), 'data', 'backups')
      if (existsSync(backupDir)) {
        const files = readdirSync(backupDir).filter(f => f.startsWith('auto-backup-')).sort()
        if (files.length > 0) {
          const latest = files[files.length - 1]
          const dateMatch = latest.match(/auto-backup-(\d{4}-\d{2}-\d{2})/)
          if (dateMatch) DEFAULT_CONFIG.lastBackupDate = dateMatch[1]
        }
      }
    } catch {}
  }
  return { ...DEFAULT_CONFIG }
}

export default defineEventHandler(async (event) => {
  requireAuth(event)
  return loadBackupSchedule()
})
