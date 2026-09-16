/**
 * POST /api/token-deals/:id/vote — 可用性投票
 * Body: { vote: 'up' | 'down' }
 *
 * 一人一票：重复投同一方向视为取消，投相反方向视为改票。
 * 投票后在同一事务内重算主表缓存计数。
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { syncDealCounters } from '../../../utils/token-deals'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const vote = String(body?.vote ?? '')
  if (vote !== 'up' && vote !== 'down') {
    throw createError({ statusCode: 400, data: { error: '投票取值必须是 up 或 down' } })
  }

  const db = getRawDb()
  const deal = db.prepare('SELECT id FROM token_deals WHERE id = ?').get(id)
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  const existing = db.prepare(
    'SELECT id, vote FROM token_deal_votes WHERE deal_id = ? AND user_id = ?'
  ).get(id, user.id) as { id: number; vote: string } | undefined

  const now = Date.now()
  let myVote: string | null = vote

  try {
    db.transaction(() => {
      if (!existing) {
        db.prepare(
          'INSERT INTO token_deal_votes (deal_id, user_id, vote, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(id, user.id, vote, now, now)
      } else if (existing.vote === vote) {
        // 再次点击同一方向 = 取消投票
        db.prepare('DELETE FROM token_deal_votes WHERE id = ?').run(existing.id)
        myVote = null
      } else {
        db.prepare('UPDATE token_deal_votes SET vote = ?, updated_at = ? WHERE id = ?')
          .run(vote, now, existing.id)
      }
      syncDealCounters(db, id)
    })()
  } catch (err: any) {
    console.error('投票失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '投票失败' } })
  }

  const counters = db.prepare('SELECT vote_up, vote_down FROM token_deals WHERE id = ?')
    .get(id) as { vote_up: number; vote_down: number }

  return {
    success: true,
    my_vote: myVote,
    vote_up: counters.vote_up,
    vote_down: counters.vote_down,
  }
})
