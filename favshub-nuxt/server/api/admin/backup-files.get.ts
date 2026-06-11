/**
 * GET /api/admin/backup-files — 获取备份文件列表
 */
import { requireAdmin } from '../../utils/auth'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const backupDir = join(process.cwd(), 'data', 'backups')
  if (!existsSync(backupDir)) {
    return { files: [] }
  }

  const files = readdirSync(backupDir)
    .filter(f => f.startsWith('auto-backup-') || f.startsWith('manual-backup-'))
    .sort()
    .reverse()
    .map(f => {
      const stat = statSync(join(backupDir, f))
      return {
        name: f,
        size: stat.size,
        sizeFormatted: stat.size > 1024 * 1024
          ? (stat.size / 1024 / 1024).toFixed(2) + ' MB'
          : (stat.size / 1024).toFixed(1) + ' KB',
        time: stat.mtime.toISOString(),
        type: f.startsWith('manual-') ? 'manual' : 'auto'
      }
    })

  return { files }
})
