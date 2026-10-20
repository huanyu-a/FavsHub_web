/**
 * POST /api/admin/token-deals/subscriptions/:id — 订阅管理（仅管理员）
 *
 * Body: { action: 'pause' | 'resume' | 'revoke' | 'delete' }
 *
 * 只处理「站点侧的账本」，不触碰游客机器上的任何东西：暂停后他的轮询会拿到
 * `paused: true` 的空结果；删除则是彻底抹掉这行（游客侧游标失效，需重建）。
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'

const ACTIONS = ['pause', 'resume', 'revoke', 'delete'] as const

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({} as any))
  const action = String(body?.action || '')

  if (!(ACTIONS as readonly string[]).includes(action)) {
    throw createError({ statusCode: 400, data: { error: `action 取值必须是 ${ACTIONS.join(' / ')}` } })
  }

  const db = getRawDb()
  const row = db.prepare('SELECT id, status FROM deal_subscriptions WHERE id = ?').get(id) as any
  if (!row) throw createError({ statusCode: 404, data: { error: '订阅不存在' } })

  const now = Date.now()
  if (action === 'delete') {
    db.prepare('DELETE FROM deal_subscriptions WHERE id = ?').run(id)
    return { success: true, action, message: '订阅记录已彻底删除' }
  }

  const next = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'revoked'
  db.prepare('UPDATE deal_subscriptions SET status = ?, updated_at = ? WHERE id = ?').run(next, now, id)
  return { success: true, action, status: next }
})
