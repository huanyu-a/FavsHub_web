/**
 * GET /api/token-deals/:id/reviews — 评测列表（登录用户评测 + 已通过游客评测）
 *
 * Query: page, limit
 * 公开可读，附带 1-5 星分布便于前端渲染评分条。
 *
 * ## 两条数据源的合并
 *
 * 登录用户的评测在 `token_deal_reviews`（一人一评，直接生效）；
 * 游客评测在 `token_deal_guest_reviews`（默认待审，**仅 approved 展示**）。
 * 两者在读取层合并为统一结构（`source` 字段区分），前端无需关心来源差异。
 *
 * ## 头像
 *
 * 两类评测都只返回 `avatar` URL（形如 `/avatar/<加密令牌>.jpg`），
 * **绝不返回 QQ 号本身** —— QQ 号在服务端加密存储，代理端点解密后回源取图。
 * 未填 QQ 号时 `avatar` 为 null，前端回退为昵称首字母色块。
 *
 * ## 打标（社区健康度第三维）
 *
 * 每条评测附带 `mark_count`（被多少人标「有用」）与 `my_marked`（当前访客标过没）。
 * 计数**按页批量取**（一条 `IN (...)` 查询）而非逐条查，避免 N+1。
 */
import { getRawDb } from '../../../database'
import { avatarUrl } from '../../../utils/avatar'
import { currentFingerprint, reviewMarkStats } from '../../../utils/review-marks'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const query = getQuery(event)

  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(query.limit as string) || 10))
  const offset = (page - 1) * limit

  const db = getRawDb()
  const deal = db.prepare('SELECT id FROM token_deals WHERE id = ?').get(id)
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  // ── 登录用户评测 ──
  const userReviews = db.prepare(`
    SELECT r.id, r.rating, r.content, r.created_at, r.updated_at,
           COALESCE(NULLIF(u.nickname, ''), u.username, '匿名') AS author,
           u.qq_cipher
    FROM token_deal_reviews r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.deal_id = ?
    ORDER BY r.updated_at DESC, r.id DESC
  `).all(id) as any[]

  // ── 游客评测（仅已通过）──
  let guestRows: any[] = []
  try {
    guestRows = db.prepare(`
      SELECT id, nickname, qq_cipher, rating, content, created_at, updated_at
      FROM token_deal_guest_reviews
      WHERE deal_id = ? AND status = 'approved'
      ORDER BY updated_at DESC, id DESC
    `).all(id) as any[]
  } catch { /* 表未迁移时按空处理，不影响登录用户评测展示 */ }

  // 合并 + 按更新时间倒序（统一为同一结构，前端不必分支）
  const merged = [
    ...userReviews.map(r => ({
      id: `u_${r.id}`,
      rating: r.rating,
      content: r.content,
      created_at: r.created_at,
      updated_at: r.updated_at,
      author: r.author,
      avatar: avatarUrl(r.qq_cipher),
      source: 'user' as const,
    })),
    ...guestRows.map(r => ({
      id: `g_${r.id}`,
      rating: r.rating,
      content: r.content,
      created_at: r.created_at,
      updated_at: r.updated_at,
      author: r.nickname || '匿名',
      avatar: avatarUrl(r.qq_cipher),
      source: 'guest' as const,
    })),
  ].sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0))

  const total = merged.length
  const reviews = merged.slice(offset, offset + limit)

  // ── 打标计数（本页批量取，避免 N+1）──
  // 身份摘要一次解析，既用于计数也用于「我标过没」；表未迁移时降级为空统计
  const { counts, mine } = reviewMarkStats(
    db,
    reviews.map(r => r.id),
    currentFingerprint(event),
  )
  for (const r of reviews) {
    r.mark_count = counts[r.id] || 0
    r.my_marked = mine.has(r.id)
  }

  // ── 星级分布（两类合并）──
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const r of merged) {
    if (r.rating >= 1 && r.rating <= 5) distribution[r.rating]++
  }

  return {
    reviews,
    distribution,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
})