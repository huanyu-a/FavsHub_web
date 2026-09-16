/**
 * POST /api/token-deals/:id/pin — 置顶切换（仅管理员）
 * Body: { pinned?: boolean }  省略时按当前状态取反
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({} as any))

  const db = getRawDb()
  const deal = db.prepare('SELECT id, pinned FROM token_deals WHERE id = ?').get(id) as
    { id: string; pinned: number } | undefined
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  const next = typeof body?.pinned === 'boolean'
    ? (body.pinned ? 1 : 0)
    : (deal.pinned ? 0 : 1)

  db.prepare('UPDATE token_deals SET pinned = ? WHERE id = ?').run(next, id)

  return { success: true, pinned: next }
})
