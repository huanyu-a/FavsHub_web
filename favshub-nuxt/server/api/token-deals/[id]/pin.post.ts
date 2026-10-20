/**
 * POST /api/token-deals/:id/pin — 置顶切换（仅管理员）
 * Body: { pinned?: boolean }  省略时按当前状态取反
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { appendDealEvent } from '../../../utils/deal-events'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({} as any))

  const db = getRawDb()
  const deal = db.prepare(
    'SELECT id, pinned, deleted_at, invalid_at, expires_at FROM token_deals WHERE id = ?'
  ).get(id) as { id: string; pinned: number; deleted_at: number | null; invalid_at: number | null; expires_at: number | null } | undefined
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }
  // 置顶一条不可见的通告只会污染首页顶部排序，直接拒绝
  if (deal.deleted_at || deal.invalid_at || (deal.expires_at && deal.expires_at <= Date.now())) {
    throw createError({ statusCode: 404, data: { error: '通告不存在或已失效' } })
  }

  const next = typeof body?.pinned === 'boolean'
    ? (body.pinned ? 1 : 0)
    : (deal.pinned ? 0 : 1)

  db.prepare('UPDATE token_deals SET pinned = ? WHERE id = ?').run(next, id)

  // 置顶变化也进事件流（默认订阅集合不含 pinned，需要的人显式开启）
  appendDealEvent(db, id, 'pinned', { reason: next ? 'pin' : 'unpin', before: deal })

  return { success: true, pinned: next }
})
