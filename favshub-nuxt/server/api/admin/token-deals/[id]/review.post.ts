/**
 * POST /api/admin/token-deals/:id/review — 审核通告（仅管理员）
 * Body: { action: 'approve' | 'reject', reason?: string }
 *
 * 写库语义与通知链路在 server/utils/token-deals.ts 的 reviewDealById
 * （与 QQ 机器人「通过 / 驳回」指令共享同一实现）。
 */
import { requireAdmin } from '../../../../utils/auth'
import { reviewDealById } from '../../../../utils/token-deals'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    throw createError({ statusCode: 400, data: { error: '审核动作必须是 approve 或 reject' } })
  }

  const result = reviewDealById(id, action, String(body?.reason ?? ''))
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return { success: true, status: action === 'approve' ? 'approved' : 'rejected' }
})
