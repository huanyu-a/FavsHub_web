/**
 * POST /api/admin/token-deals/:id/review — 审核通告（仅管理员）
 * Body: { action: 'approve' | 'reject', reason?: string }
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    throw createError({ statusCode: 400, data: { error: '审核动作必须是 approve 或 reject' } })
  }

  const db = getRawDb()
  const deal = db.prepare('SELECT id FROM token_deals WHERE id = ?').get(id)
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  const status = action === 'approve' ? 'approved' : 'rejected'
  const reason = action === 'reject' ? String(body?.reason ?? '').trim().slice(0, 200) : ''

  db.prepare(
    'UPDATE token_deals SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?'
  ).run(status, reason, Date.now(), id)

  return { success: true, status }
})
