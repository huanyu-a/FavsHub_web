/**
 * GET /api/prompts/:id/my-review-request — 用户查看自己对某个提示词的审核请求状态
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  if (!id) return { request: null }

  const request = db.prepare(`
    SELECT * FROM prompt_review_requests
    WHERE prompt_id = ? AND user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(id, auth.id)

  return { request: request || null }
})