/**
 * GET /api/health — 健康检查 + 数据库连接验证
 */
import { getRawDb } from '../database'

export default defineEventHandler(() => {
  try {
    const db = getRawDb()

    // 验证数据库连接
    const result = db.prepare('SELECT 1 as ok').get() as { ok: number }
    const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
    const bookmarkCount = (db.prepare('SELECT COUNT(*) as c FROM bookmarks').get() as { c: number }).c
    const promptCount = (db.prepare('SELECT COUNT(*) as c FROM prompts').get() as { c: number }).c

    return {
      status: 'ok',
      database: 'connected',
      stats: {
        users: userCount,
        bookmarks: bookmarkCount,
        prompts: promptCount,
      },
      timestamp: Date.now(),
    }
  } catch (err: any) {
    return {
      status: 'error',
      database: 'disconnected',
      error: err.message,
      timestamp: Date.now(),
    }
  }
})
