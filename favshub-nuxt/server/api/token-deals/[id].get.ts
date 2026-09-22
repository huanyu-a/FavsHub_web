/**
 * GET /api/token-deals/:id — 通告详情
 * 附带当前用户的投票与评测状态；未审核通过的通告仅作者与管理员可见。
 * 附带 Nexus 接入信息（分享卡片需要展示实测可用率与耗时）；Nexus 表缺失时降级为 null，不阻断详情。
 * 附带修改建议摘要（`edits`）：自己那条待审提案、待审总数、自己是否可审核。
 * 附带游客评测摘要（`guest_review`）：当前访客自己那条待审评测（按 IP+UA 指纹识别）。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { dealEditSummary } from '../../utils/deal-edits'
import { guestReviewSummary } from '../../utils/guest-reviews'
import { myVoteFor } from '../../utils/deal-votes'

function parseModels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

interface NexusInfo {
  channel_id: number
  name: string
  status: number
  enabled: boolean
  eval_ok: number
  eval_total: number
  eval_avg_ms: number
  eval_at: number
}

/** 读取通告的 Nexus 渠道信息；表未迁移（旧库）或查询异常时返回 null */
function loadNexusInfo(db: any, dealId: string): NexusInfo | null {
  try {
    const row = db.prepare(`
      SELECT n.channel_id, n.name, n.status, n.eval_ok, n.eval_total, n.eval_avg_ms, n.eval_at
      FROM nexus_deal_map m
      JOIN nexus_channels n ON n.channel_id = m.channel_id
      WHERE m.deal_id = ?
    `).get(dealId) as any
    if (!row) return null
    return {
      channel_id: row.channel_id,
      name: row.name,
      status: row.status,
      enabled: row.status === 1,
      eval_ok: row.eval_ok || 0,
      eval_total: row.eval_total || 0,
      eval_avg_ms: row.eval_avg_ms || 0,
      eval_at: row.eval_at || 0,
    }
  } catch {
    return null
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

  // 我的投票：登录用户查原表，游客查游客表（投票已开放给游客，故不能只在 role 分支里取）
  const myVote = myVoteFor(db, event, id, role?.user.id ?? null)

  let myReview: { rating: number; content: string; updated_at: number | null } | null = null

  if (role) {
    const review = db.prepare(
      'SELECT rating, content, updated_at FROM token_deal_reviews WHERE deal_id = ? AND user_id = ?'
    ).get(id, role.user.id) as any
    myReview = review ?? null
  }

  // 修改建议摘要：表不存在（旧库未迁移）时降级为 null，不阻断详情
  let edits: ReturnType<typeof dealEditSummary> | null = null
  try {
    edits = dealEditSummary(db, role, row)
  } catch (err: any) {
    console.warn('[token-deals] 读取修改建议摘要失败:', err?.message)
  }

  // 游客评测摘要：当前访客自己那条待审评测（按 IP+UA 指纹识别，未登录也能回显）
  let guestReview: ReturnType<typeof guestReviewSummary> | null = null
  try {
    guestReview = guestReviewSummary(db, event, id)
  } catch (err: any) {
    console.warn('[token-deals] 读取游客评测摘要失败:', err?.message)
  }

  return {
    deal: {
      ...row,
      models: parseModels(row.models),
      is_expired: !!row.expires_at && row.expires_at < Date.now(),
      is_owner: isOwner,
      can_edit: isOwner || isAdmin,
      can_moderate: isAdmin,
      nexus: loadNexusInfo(db, id),
    },
    edits,
    guest_review: guestReview,
    my_vote: myVote,
    my_review: myReview,
  }
})
