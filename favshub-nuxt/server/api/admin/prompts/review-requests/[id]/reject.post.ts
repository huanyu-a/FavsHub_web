/**
 * POST /api/admin/prompts/review-requests/:id/reject — 审核拒绝
 * 记录拒绝原因，通知提交者
 */
import { getRawDb } from '../../../../../database'
import { requireAdmin } from '../../../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  if (!id) throw createError({ statusCode: 400, data: { error: '无效的审核 ID' } })

  const request = db.prepare('SELECT * FROM prompt_review_requests WHERE id = ?').get(id) as any
  if (!request) throw createError({ statusCode: 404, data: { error: '审核请求不存在' } })
  if (request.status !== 'pending') throw createError({ statusCode: 400, data: { error: '该请求已被处理' } })

  const body = await readBody(event)
  const comment = body?.comment || ''

  const now = Date.now()

  db.prepare(`UPDATE prompt_review_requests SET status = 'rejected', admin_comment = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`).run(comment, now, auth.id, id)

  return { success: true, message: '已拒绝' }
})