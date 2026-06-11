/**
 * PUT /api/admin/backup-schedule — 更新备份配置
 */
import { requireAdmin } from '../../utils/auth'
import { readBody } from 'h3'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BACKUP_CONFIG_FILE = join(process.cwd(), 'data', '.backup-config.json')
const DEFAULT_CONFIG = { enabled: false, hour: 3, minute: 0, keepCopies: 7, lastBackupDate: null }

function loadConfig(): typeof DEFAULT_CONFIG {
  try {
    if (existsSync(BACKUP_CONFIG_FILE)) {
      const saved = JSON.parse(readFileSync(BACKUP_CONFIG_FILE, 'utf8'))
      return { ...DEFAULT_CONFIG, ...saved }
    }
  } catch {}
  return { ...DEFAULT_CONFIG }
}

function saveConfig(config: typeof DEFAULT_CONFIG) {
  try {
    writeFileSync(BACKUP_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
  } catch (err: any) {
    console.error('[备份] 保存配置失败:', err.message)
  }
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const body = await readBody(event)
  const { enabled, hour, minute, keepCopies } = body

  const schedule = loadConfig()

  if (enabled !== undefined) schedule.enabled = !!enabled
  if (hour !== undefined) schedule.hour = Math.max(0, Math.min(23, parseInt(hour) || 0))
  if (minute !== undefined) schedule.minute = Math.max(0, Math.min(59, parseInt(minute) || 0))
  if (keepCopies !== undefined) schedule.keepCopies = Math.max(1, parseInt(keepCopies) || 7)

  saveConfig(schedule)

  return { success: true, schedule }
})
