/**
 * PUT /api/admin/token-deals/:id/state — 设置通告状态（管理员 / 作者本人）
 * Body: { state: 'pending'|'verified'|'published'|'offline'|'invalid'|'rejected', reason?: string }
 *
 * 为什么单独开一个端点，而不是塞进 review.post：
 *   - review 只有 approve/reject 两个动作，粒度太粗，改不到「已审核 → 已发布」这一档
 *   - 状态是本次重构的核心概念，单独端点便于前端下拉直接映射
 *
 * 权限：
 *   - 管理员：任意条目、任意状态
 *   - 作者本人：只能在自己的条目上做「提交审核(pending) / 下架(offline)」，
 *     **不能**自行 published 或 verified —— 否则自审自过，审核形同虚设
 */
import { requireAuth, isAdminUserById } from '../../../../utils/auth'
import { setDealState, SETTABLE_STATES, DEAL_STATE_LABELS } from '../../../../utils/token-deals'
import type { DealState, InvalidReason } from '../../../../utils/token-deals'
import { getRawDb } from '../../../../database'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const next = String(body?.state ?? '') as DealState
  if (!(SETTABLE_STATES as readonly string[]).includes(next)) {
    throw createError({
      statusCode: 400,
      data: { error: `状态必须是 ${SETTABLE_STATES.join(' / ')} 之一` },
    })
  }

  const db = getRawDb()
  const deal = db.prepare('SELECT id, user_id, state FROM token_deals WHERE id = ?')
    .get(id) as { id: string; user_id: number; state: string } | undefined
  if (!deal) throw createError({ statusCode: 404, data: { error: '通告不存在' } })

  const isAdmin = isAdminUserById(user.id)
  const isOwner = deal.user_id === user.id

  if (!isAdmin) {
    if (!isOwner) throw createError({ statusCode: 404, data: { error: '通告不存在' } })
    // 作者只能「提交审核」或「下架」，不能自发布 / 自审核
    if (next !== 'pending' && next !== 'offline') {
      throw createError({
        statusCode: 403,
        data: { error: `作者本人只能提交审核或下架，不能设置为「${DEAL_STATE_LABELS[next]}」` },
      })
    }
  }

  const reason = String(body?.reason ?? '').trim().slice(0, 200)
  const invalidReason = (['expired', 'votes', 'manual'] as const)
    .includes(body?.invalidReason as InvalidReason)
    ? (body.invalidReason as InvalidReason)
    : 'manual'

  const result = setDealState(db, id, next, { actorId: user.id, invalidReason })
  if (!result.ok) {
    throw createError({ statusCode: result.status || 400, data: { error: result.error } })
  }

  // 驳回原因单独写（setDealState 不处理业务原因文案）
  if (next === 'rejected') {
    db.prepare('UPDATE token_deals SET reject_reason = ? WHERE id = ?').run(reason, id)
  }

  return {
    success: true,
    from: result.from,
    to: result.to,
    changed: result.changed,
    label: DEAL_STATE_LABELS[next],
  }
})
