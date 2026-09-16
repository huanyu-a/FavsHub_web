/**
 * DELETE /api/token-deals/:id — 删除通告
 * 作者或管理员可删除。级联清理该通告的投票与评测。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }
  const { user, isAdmin } = role

  const { id } = getRouterParams(event)
  const db = getRawDb()

  const deal = db.prepare('SELECT id, user_id FROM token_deals WHERE id = ?').get(id) as any
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }
  if (deal.user_id !== user.id && !isAdmin) {
    throw createError({ statusCode: 403, data: { error: '无权删除此通告' } })
  }

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM token_deal_votes WHERE deal_id = ?').run(id)
      db.prepare('DELETE FROM token_deal_reviews WHERE deal_id = ?').run(id)
      db.prepare('DELETE FROM token_deals WHERE id = ?').run(id)
    })()
  } catch (err: any) {
    console.error('删除 Token 白嫖通告失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '删除失败' } })
  }

  return { success: true }
})
