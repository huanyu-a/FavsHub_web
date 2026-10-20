/**
 * POST /api/admin/token-deals/:id/verify — 人工核验（仅管理员）
 *
 * Body: { action: 'alive' | 'dead' | 'note', note?: string }
 *
 * 白嫖资源最怕「早失效了还挂着」：社区投票是用户反馈，人工核验是站点确认
 * 「此刻仍可用」。核验**不产生事件**（确认没变化不该推给订阅者），
 * 只有 action='dead' 判定失效时才走 offline 事件（订阅者收到「下架」）。
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'
import { VERIFY_ACTIONS, verifyDeal } from '../../../../utils/token-deals'

export default defineEventHandler(async (event) => {
  const role = requireAdmin(event)
  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '缺少通告 ID' } })
  }

  const body = await readBody(event).catch(() => ({} as any))
  const action = String(body?.action ?? '')
  if (!(VERIFY_ACTIONS as readonly string[]).includes(action)) {
    throw createError({ statusCode: 400, data: { error: 'action 必须是 alive / dead / note' } })
  }

  const db = getRawDb()
  const result = verifyDeal(db, String(id), {
    action: action as (typeof VERIFY_ACTIONS)[number],
    note: String(body?.note ?? ''),
    actor: String(role.username || 'admin'),
  })

  if (!result.ok) {
    throw createError({ statusCode: 404, data: { error: result.message || '核验失败' } })
  }
  return { success: true, ...result }
})
