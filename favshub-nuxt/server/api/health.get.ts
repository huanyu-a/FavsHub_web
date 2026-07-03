/**
 * GET /api/health — 健康检查（公开，仅返回连接状态，不泄露统计数据）
 */
import { getRawDb } from '../database'

export default defineEventHandler(() => {
  try {
    const db = getRawDb()

    // 验证数据库连接（不返回具体数据量，防止信息泄露）
    db.prepare('SELECT 1 as ok').get()

    return {
      status: 'ok',
      database: 'connected',
      timestamp: Date.now(),
    }
  } catch {
    return {
      status: 'error',
      database: 'disconnected',
      timestamp: Date.now(),
    }
  }
})
