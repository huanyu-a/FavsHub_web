/**
 * GET /api/admin/backup/download — 下载数据库备份
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, setResponseHeaders } from 'h3'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const d = new Date()
  const timestamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`
  const filename = `favshub-backup-${timestamp}.db`

  const config = useRuntimeConfig(event)
  const dbPath = config.dbPath || join(process.cwd(), 'data', 'favshub.db')

  if (!existsSync(dbPath)) {
    throw createError({ statusCode: 404, data: { error: '数据库文件不存在' } })
  }

  db.pragma('wal_checkpoint(TRUNCATE)')

  setResponseHeaders(event, {
    'Content-Type': 'application/x-sqlite3',
    'Content-Disposition': `attachment; filename="${filename}"`,
  })
  return readFileSync(dbPath)
})
