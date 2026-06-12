/**
 * GET /api/admin/backup/info — 获取备份状态信息
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const db = getRawDb()
  const config = useRuntimeConfig(event)
  const dbPath = config.dbPath || join(process.cwd(), 'data', 'favshub.db')

  let dbSize = 0
  let lastModified: string | null = null
  try {
    if (existsSync(dbPath)) {
      const stat = statSync(dbPath)
      dbSize = stat.size
      lastModified = stat.mtime.toISOString()
    }
  } catch { /* ignore */ }

  const stats = {
    users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c,
    bookmarks: (db.prepare('SELECT COUNT(*) as c FROM bookmarks').get() as any).c,
    folders: (db.prepare('SELECT COUNT(*) as c FROM folders').get() as any).c,
    prompts: (db.prepare('SELECT COUNT(*) as c FROM prompts').get() as any).c,
    search_engines: (db.prepare('SELECT COUNT(*) as c FROM search_engines').get() as any).c,
  }

  return {
    dbPath,
    dbSize,
    dbSizeFormatted: dbSize > 1024 * 1024
      ? (dbSize / 1024 / 1024).toFixed(2) + ' MB'
      : (dbSize / 1024).toFixed(2) + ' KB',
    lastModified,
    stats,
  }
})
