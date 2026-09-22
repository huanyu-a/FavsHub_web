/**
 * DELETE /api/token-deals/:id — 删除通告
 * 作者或管理员可删除。显式清理该通告的投票、评测与修改建议
 * （不依赖 FK 级联：CLI 与部分连接默认 foreign_keys=OFF，级联会静默失效）。
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
      db.prepare('DELETE FROM token_deal_edits WHERE deal_id = ?').run(id)
      db.prepare('DELETE FROM token_deal_guest_reviews WHERE deal_id = ?').run(id)
      // 评测打标：review_id 跨两张表故无 FK，必须显式清理，否则留下孤儿打标行
      db.prepare('DELETE FROM token_deal_review_marks WHERE deal_id = ?').run(id)
      // 游客投票：同样无 FK（游客没有 users 行），不显式清理即留下孤儿票
      db.prepare('DELETE FROM token_deal_guest_votes WHERE deal_id = ?').run(id)
      db.prepare('DELETE FROM token_deals WHERE id = ?').run(id)
    })()
  } catch (err: any) {
    console.error('删除 Token 白嫖通告失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '删除失败' } })
  }

  return { success: true }
})
