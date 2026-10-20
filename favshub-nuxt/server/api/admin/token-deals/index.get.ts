/**
 * GET /api/admin/token-deals — 管理端通告列表（仅管理员）
 * Query: status (pending|approved|rejected|all), view (queue|invalid), search, page, limit
 *
 * 两个视图（2026-10-20「已失效」面板）：
 *   - `view=queue`（默认）：审核队列，按 `status` 分 tab，**只含在架条目**
 *     （未删除、未失效、未过期）—— 与失效面板互不重叠，Tab 徽章才与列表一致
 *   - `view=invalid`：已失效面板 —— 已过期 / 判定失效 / 已删除 三类合流，
 *     每行带 `lifecycle` 分类与失效原因；可再带 `lifecycle=expired|invalid|deleted` 子筛选
 *
 * 同时返回各状态计数，供后台 Tab 徽章展示。
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { archiveExpiredDeals, escapeLike, INVALID_REASON_LABELS } from '../../../utils/token-deals'

function parseModels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ── 生命周期三类判定（互斥，优先级：已删除 > 判定失效 > 已过期）──
//
// 归档任务（archiveExpiredDeals）会把到期行写成 `invalid_reason = 'expired'`，
// 因此「过期」= 到期原因已落库 或 到期时刻已过但尚未归档 —— 两种形态都归 expired，
// 否则同一行在计数与行分类之间会漂移到「判定失效」里。
// SQL 片段与行内判定共用同一份定义，避免两处漂移。
const P_DELETED = 'deleted_at IS NOT NULL'
const P_INVALID = "deleted_at IS NULL AND invalid_at IS NOT NULL AND COALESCE(invalid_reason, '') <> 'expired'"
const P_EXPIRED = "deleted_at IS NULL AND (invalid_reason = 'expired' OR (invalid_at IS NULL AND expires_at IS NOT NULL AND expires_at <= @NOW@))"
const P_LIVE = 'deleted_at IS NULL AND invalid_at IS NULL AND (expires_at IS NULL OR expires_at > @NOW@)'

/** 行分类：与上面三个 SQL 片段同语义 */
function classify(row: any, now: number): 'deleted' | 'invalid' | 'expired' | 'live' {
  if (row.deleted_at) return 'deleted'
  if (row.invalid_reason === 'expired') return 'expired'
  if (row.invalid_at) return 'invalid'
  if (row.expires_at && row.expires_at <= now) return 'expired'
  return 'live'
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const query = getQuery(event)
  const view = String(query.view || 'queue')
  // 已失效面板内的子筛选（与行分类同优先级：已删除 > 判定失效 > 已过期）
  const lifecycle = String(query.lifecycle || 'all')
  const status = String(query.status || 'pending')
  const search = String(query.search || '').trim()
  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 20))
  const offset = (page - 1) * limit
  const now = Date.now()

  const db = getRawDb()

  let where = '1 = 1'
  const params: any[] = []

  const withNow = (frag: string) => frag.replace(/@NOW@/g, String(now))

  if (view === 'invalid') {
    // 进面板先归档一次（幂等、只写真正新过期的行），使「失效时间」落的是真实到期时刻
    // 而非管理员打开页面的时间。公开列表不依赖它 —— 那边是运行时判过期。
    archiveExpiredDeals(db, now)

    // 已失效面板：三类合流（过期项不依赖归档是否跑过，按 expires_at 兜住）
    where += ` AND (${['d.' + P_DELETED, 'd.' + P_INVALID, 'd.' + P_EXPIRED]
      .map(withNow).join(' OR ')})`
    if (lifecycle === 'deleted') where += ` AND d.${P_DELETED}`
    else if (lifecycle === 'invalid') where += ` AND d.${withNow(P_INVALID)}`
    else if (lifecycle === 'expired') where += ` AND d.${withNow(P_EXPIRED)}`
  } else {
    // 审核队列只看在架条目：失效/过期/已删除都属于「已失效」面板，两个视图互不重叠，
    // 否则 Tab 徽章数字与列表内容会对不上，管理员也无从判断某条到底在哪个视图。
    where += ` AND d.${withNow(P_LIVE)}`
    if (status !== 'all') {
      where += ' AND d.status = ?'
      params.push(status)
    }
  }

  if (search) {
    const escaped = escapeLike(search)
    where += ` AND (d.provider LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\')`
    const like = `%${escaped}%`
    params.push(like, like)
  }

  const total = (db.prepare(`SELECT COUNT(*) AS total FROM token_deals d WHERE ${where}`)
    .get(...params) as { total: number }).total

  const rows = db.prepare(`
    SELECT d.*, u.username,
      CASE WHEN d.guest_name IS NOT NULL AND d.guest_name != '' THEN d.guest_name ELSE u.nickname END AS nickname
    FROM token_deals d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE ${where}
    ORDER BY d.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  // ── 计数 ──
  // 队列计数（待审 / 已发布 / 驳回 / 全部）只算在架条目，与队列视图同口径；
  // 「已失效」三类各自单列，三类之和 = invalid_total = 已失效面板总数。
  const liveWhere = withNow(P_LIVE)
  const countRows = db.prepare(`
    SELECT status, COUNT(*) AS count FROM token_deals
    WHERE ${liveWhere} GROUP BY status
  `).all() as { status: string; count: number }[]

  const counts: Record<string, number> = {
    pending: 0, approved: 0, rejected: 0, all: 0,
    expired: 0, invalid: 0, deleted: 0, invalid_total: 0,
  }
  for (const row of countRows) {
    counts[row.status] = row.count
    counts.all += row.count
  }

  const lifeCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN ${withNow(P_DELETED)} THEN 1 ELSE 0 END) AS deleted,
      SUM(CASE WHEN ${withNow(P_INVALID)} THEN 1 ELSE 0 END) AS invalid,
      SUM(CASE WHEN ${withNow(P_EXPIRED)} THEN 1 ELSE 0 END) AS expired
    FROM token_deals
  `).get() as { deleted: number | null; invalid: number | null; expired: number | null } | undefined

  counts.deleted = lifeCounts?.deleted || 0
  counts.invalid = lifeCounts?.invalid || 0
  counts.expired = lifeCounts?.expired || 0
  counts.invalid_total = counts.deleted + counts.invalid + counts.expired

  return {
    view,
    deals: rows.map(row => ({
      ...row,
      models: parseModels(row.models),
      is_expired: !!row.expires_at && row.expires_at < now,
      lifecycle: classify(row, now),
      invalid_reason_label: row.invalid_at
        ? (INVALID_REASON_LABELS[row.invalid_reason] || '已失效')
        : '',
    })),
    counts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
})
