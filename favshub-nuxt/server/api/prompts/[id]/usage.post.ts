/**
 * POST /api/prompts/:id/usage — 提示词使用计数 +1
 * 用户复制/使用时调用，记录热度
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { getRouterParam } from 'h3'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    return { success: false }
  }

  const db = getRawDb()
  db.prepare('UPDATE prompts SET usage_count = usage_count + 1 WHERE id = ?').run(id)

  return { success: true }
})
