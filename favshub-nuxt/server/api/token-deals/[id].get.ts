/**
 * GET /api/token-deals/:id — 通告详情
 * 附带当前用户的投票与评测状态；未审核通过的通告仅作者与管理员可见。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'

function parseModels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '缺少通告 ID' } })
  }

  const role = getAuthRole(event)
  const db = getRawDb()

  const row = db.prepare(`
    SELECT d.*, u.username, u.nickname
    FROM token_deals d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE d.id = ?
  `).get(id) as any

  if (!row) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  const isOwner = !!role && role.user.id === row.user_id
  const isAdmin = !!role?.isAdmin

  if (row.status !== 'approved' && !isOwner && !isAdmin) {
    throw createError({ statusCode: 403, data: { error: '该通告尚未通过审核' } })
  }

  let myVote: string | null = null
  let myReview: { rating: number; content: string; updated_at: number | null } | null = null

  if (role) {
    const vote = db.prepare(
      'SELECT vote FROM token_deal_votes WHERE deal_id = ? AND user_id = ?'
    ).get(id, role.user.id) as { vote: string } | undefined
    myVote = vote?.vote ?? null

    const review = db.prepare(
      'SELECT rating, content, updated_at FROM token_deal_reviews WHERE deal_id = ? AND user_id = ?'
    ).get(id, role.user.id) as any
    myReview = review ?? null
  }

  return {
    deal: {
      ...row,
      models: parseModels(row.models),
      is_expired: !!row.expires_at && row.expires_at < Date.now(),
      is_owner: isOwner,
      can_edit: isOwner || isAdmin,
      can_moderate: isAdmin,
    },
    my_vote: myVote,
    my_review: myReview,
  }
})
