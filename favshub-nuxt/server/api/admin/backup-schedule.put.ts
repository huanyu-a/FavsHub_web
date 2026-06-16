/**
 * PUT /api/admin/backup-schedule — 更新备份配置
 */
import { requireAdmin } from '../../utils/auth'
import { readBody } from 'h3'
import { getRawDb } from '../../database'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody(event)
  const { enabled, hour, minute, keepCopies } = body

  const db = getRawDb()
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)'
  )
  const now = Date.now()

  if (enabled !== undefined) upsert.run('backup_enabled', String(!!enabled), now)
  if (hour !== undefined) upsert.run('backup_hour', String(Math.max(0, Math.min(23, parseInt(hour) || 0))), now)
  if (minute !== undefined) upsert.run('backup_minute', String(Math.max(0, Math.min(59, parseInt(minute) || 0))), now)
  if (keepCopies !== undefined) upsert.run('backup_keep_copies', String(Math.max(1, parseInt(keepCopies) || 7)), now)

  return {
    success: true,
    schedule: {
      enabled: enabled !== undefined ? !!enabled : undefined,
      hour, minute, keepCopies,
    },
  }
})
