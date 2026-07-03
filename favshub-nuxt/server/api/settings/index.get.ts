/**
 * GET /api/settings — 获取系统设置和用户偏好
 * 游客：只返回系统设置（过滤敏感字段）
 * 登录用户：系统设置 + 用户偏好覆盖
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

const SENSITIVE_KEYS: string[] = []

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  // 获取系统设置 (user_id = 0)
  const sysRow = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as { data: string } | undefined
  let sysSettings: Record<string, any> = {}
  try {
    sysSettings = sysRow ? JSON.parse(sysRow.data) : {}
  } catch { /* ignore */ }

  // 过滤敏感字段
  const filteredSys: Record<string, any> = {}
  for (const [k, v] of Object.entries(sysSettings)) {
    if (!SENSITIVE_KEYS.includes(k)) {
      filteredSys[k] = v
    }
  }

  // 游客直接返回过滤后的系统设置
  if (!user) {
    return { data: filteredSys }
  }

  // 登录用户：合并用户偏好
  const userRow = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(user.id) as { data: string } | undefined
  let userSettings: Record<string, any> = {}
  try {
    userSettings = userRow ? JSON.parse(userRow.data) : {}
  } catch { /* ignore */ }

  // 用户设置覆盖系统设置
  const merged = { ...filteredSys, ...userSettings }
  return { data: merged }
})
