/**
 * GET /api/admin/prompts/review-requests — 管理员查看所有审核请求
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const requests = db.prepare(`
    SELECT r.*, p.title as prompt_title, u.username as submitter_name
    FROM prompt_review_requests r
    LEFT JOIN prompts p ON r.prompt_id = p.id
    LEFT JOIN users u ON r.user_id = u.id
    ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
  `).all()

  return { requests }
})