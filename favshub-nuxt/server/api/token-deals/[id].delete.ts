/**
 * DELETE /api/token-deals/:id — 删除通告（**软删除**）
 *
 * 2026-10-20 由物理 DELETE 改为软删除（置 `deleted_at` / `deleted_by`）：
 *   - 「被删除」从此在后台「已失效」面板可追溯（物理删完就查无此条）；
 *   - 投票 / 评测 / 修改建议全部保留，管理员可一键恢复；
 *   - 彻底清除改由 `DELETE /api/admin/token-deals/:id/purge` 执行（需 confirm）。
 *
 * 权限不变：作者或管理员。作者删除后须由管理员恢复 —— 防止被下架的内容被作者
 * 自己悄悄重新上架。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { softDeleteDeal } from '../../utils/token-deals'
import { notifyTokenDealDeleted } from '../../utils/qq-notify'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }
  const { user, isAdmin } = role

  const { id } = getRouterParams(event)
  const db = getRawDb()

  const deal = db.prepare('SELECT id, user_id, title, deleted_at FROM token_deals WHERE id = ?').get(id) as any
  if (!deal || deal.deleted_at) {
    // 已删除的条目对作者不再可见（管理员在后台「已失效」面板里操作）
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }
  if (deal.user_id !== user.id && !isAdmin) {
    throw createError({ statusCode: 403, data: { error: '无权删除此通告' } })
  }

  try {
    const ok = softDeleteDeal(db, id, user.id)
    if (!ok) {
      throw createError({ statusCode: 409, data: { error: '通告已被删除' } })
    }
  } catch (err: any) {
    if (err?.statusCode) throw err
    console.error('删除 Token 白嫖通告失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '删除失败' } })
  }

  // QQ 机器人通知（fire-and-forget：失败只告警，绝不阻断主请求）
  try {
    notifyTokenDealDeleted(deal)
  } catch (err: any) {
    console.warn('[QQBot] 通告删除通知入队失败（忽略）:', err?.message || err)
  }

  return { success: true }
})
