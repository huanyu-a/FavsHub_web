/**
 * GET /api/config/registration — 检查是否允许注册（公开接口）
 */
import { getRawDb } from '../../database'

export default defineEventHandler(() => {
  const db = getRawDb()
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'allow_registration'").get() as { value: string } | undefined
  return { allowed: !row || row.value !== 'false' }
})
