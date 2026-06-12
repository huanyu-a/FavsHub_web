/**
 * GET /api/admin/prompts/history — 获取所有提示词的版本历史
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const db = getRawDb()
  const query = getQuery(event)

  const limit = Math.min(200, Math.max(1, Number(query.limit) || 100))

  const versions = db.prepare(`
    SELECT pv.*, p.title as prompt_title, u.username
    FROM prompt_versions pv
    LEFT JOIN prompts p ON pv.prompt_id = p.id
    LEFT JOIN users u ON p.user_id = u.id
    ORDER BY pv.created_at DESC
    LIMIT ?
  `).all(limit)

  return { versions }
})
