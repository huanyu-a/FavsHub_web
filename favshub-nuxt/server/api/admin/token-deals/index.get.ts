/**
 * GET /api/admin/token-deals — 管理端通告列表（仅管理员）
 * Query: status (pending|verified|published|rejected|all), view (queue|invalid),
 *        verify (all|stale|ok), search, page, limit,
 *        category / quality / region / source_tag / invalid_reason / origin
 *
 * 两个视图（2026-10-20「已失效」面板）：
 *   - `view=queue`（默认）：审核队列，按 `status` 分 tab，**只含在架条目**
 *     （未删除、未失效、未过期）—— 与失效面板互不重叠，Tab 徽章才与列表一致
 *   - `view=invalid`：已失效面板 —— 已过期 / 判定失效 / 已删除 三类合流，
 *     每行带 `lifecycle` 分类与失效原因；可再带 `lifecycle=expired|invalid|deleted` 子筛选
 *
 * 「已失效」面板的附加筛选（2026-11-09）：
 *   - `category` / `quality` / `region` / `source_tag`：业务属性，取值白名单见
 *     `utils/deal-fields.ts` 与 `utils/deal-categories.ts`；
 *   - `origin=guest|user`：发布者类型（游客通告 `user_id = 0`，注册用户 `user_id > 0`）；
 *   - `invalid_reason=expired|votes|manual`：失效原因，**只在 `view=invalid` 生效**
 *     （审核队列里的行没有失效原因，条件放上去只会恒为空集）。它算「筛选」而非「分档」，
 *     所以参与 `lifecycle_counts` 的计数（与 `category` 等一视同仁）。
 *   - 全部取值都过白名单，**非法值一律当作「未传」**，既不报错也不静默返回空列表 ——
 *     后台筛选条拼错参数时，管理员应当看到全部数据，而不是一个空面板然后去猜哪里出错。
 *   - 面板另返回 `lifecycle_counts`：**同一批筛选条件下**（含上面全部筛选、
 *     只不含 `lifecycle` 这一维）的三档条数，供 chip 显示 —— 否则 chip 永远显示全站总数，
 *     与点进去的条数对不上。
 *
 * 同时返回各状态计数（**全站口径**），供后台顶部统计卡与 Tab 徽章展示。
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import {
  archiveExpiredDeals, DEAL_CATEGORIES, escapeLike, INVALID_REASON_LABELS, isVerifyStale,
  ORIGIN_FILTERS, QUALITY_LEVELS, REGIONS, SOURCE_TAGS, verifyAgeDays, verifyStaleDays,
} from '../../../utils/token-deals'

// 发布者类型白名单（`origin=guest|user`）原先在这里写成本地常量，2026-11-09 提到
// `utils/deal-fields.ts` —— 因为后台筛选栏的两处下拉把这个值手抄在模板里，
// 三份副本必然漂移（服务端加一档，界面就少一档；界面改个词，服务端就静默不筛）。
// 游客通告落库 `user_id = 0`（见 CLAUDE.md「Token 白嫖通告」）。

/**
 * 取白名单内的枚举值，白名单外一律返回空串（= 不加这个条件）。
 *
 * 这里刻意不 throw：后台筛选条是管理员的日常工具，一个拼错的参数应当退化成
 * 「不筛」并让他看到全部数据，而不是抛 400 或返回空列表让他以为「数据没了」。
 */
function pickEnum(raw: unknown, allowed: readonly string[]): string {
  const value = String(raw ?? '').trim()
  return value && allowed.includes(value) ? value : ''
}

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
//
// 四个片段由同一个函数按表别名生成（列表查询用 'd'，计数查询用 ''），
// 与下面的 `classify()` 是同一套语义的两份实现 —— 改口径必须同时改这里和 classify()。
function lifecyclePreds(alias: string, now: number) {
  const p = alias ? `${alias}.` : ''
  return {
    deleted: `${p}state = 'deleted'`,
    // 「已失效」面板的 three-way 细分仍要区分 expired / 人工判定，故读 invalid_reason
    invalid: `${p}state = 'invalid' AND COALESCE(${p}invalid_reason, '') <> 'expired'`,
    expired: `${p}state = 'invalid' AND COALESCE(${p}invalid_reason, '') = 'expired'`,
    // 在架 = 待处理 / 待审 / 已审核 / 已发布，但**排除**下架、失效、驳回、删除
    live: `${p}state IN ('pending','verified','published')`
      + ` AND (${p}expires_at IS NULL OR ${p}expires_at > ${now})`,
  }
}

/** 行分类：与上面三个 SQL 片段同语义 */
function classify(row: any, now: number): 'deleted' | 'invalid' | 'expired' | 'live' {
  if (row.state === 'deleted') return 'deleted'
  if (row.state === 'invalid') {
    return row.invalid_reason === 'expired' ? 'expired' : 'invalid'
  }
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
  // 待核验（2026-10-20）：在架条目里筛「超过阈值没人工核验」的，供「待核验」tab 用
  const verifyFilter = String(query.verify || 'all')
  // 「已失效」面板的附加筛选（2026-11-09）：全部过白名单，非法值退化成「不筛」（见 pickEnum）
  const categoryFilter = pickEnum(query.category, DEAL_CATEGORIES)
  const qualityFilter = pickEnum(query.quality, QUALITY_LEVELS)
  const regionFilter = pickEnum(query.region, REGIONS)
  const sourceFilter = pickEnum(query.source_tag, SOURCE_TAGS)
  // 失效原因的白名单直接取自标签表的键 —— 以后加一档只改标签表一处，这里不会漂移
  const reasonFilter = pickEnum(query.invalid_reason, Object.keys(INVALID_REASON_LABELS))
  const originFilter = pickEnum(query.origin, ORIGIN_FILTERS)
  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 20))
  const offset = (page - 1) * limit
  const now = Date.now()

  const db = getRawDb()

  // 累积**非生命周期**的全部筛选条件。
  //
  // 为什么要与生命周期分开：失效面板的三档 chip 要显示「当前筛选下各档还有多少条」，
  // 而列表本身还要再叠一层 lifecycle 条件。两者共用这一份 where / params，
  // 才不会出现「chip 说 80 条、点进去只有 2 条」。
  let where = '1 = 1'
  const params: any[] = []

  const L = lifecyclePreds('d', now)

  if (view === 'invalid') {
    // 进面板先归档一次（幂等、只写真正新过期的行），使「失效时间」落的是真实到期时刻
    // 而非管理员打开页面的时间。公开列表不依赖它 —— 那边是运行时判过期。
    archiveExpiredDeals(db, now)
  } else {
    // 审核队列只看在架条目：失效/过期/已删除都属于「已失效」面板，两个视图互不重叠，
    // 否则 Tab 徽章数字与列表内容会对不上，管理员也无从判断某条到底在哪个视图。
    where += ` AND ${L.live}`
    // status 参数现在直接映射 state（pending / verified / published / ...）
    if (status !== 'all') {
      where += ' AND d.state = ?'
      params.push(status)
    }
  }

  if (view === 'queue' && verifyFilter !== 'all') {
    const staleCutoff = now - verifyStaleDays() * 86400000
    if (verifyFilter === 'stale') {
      where += ' AND (d.verified_at IS NULL OR d.verified_at = 0 OR d.verified_at < ?)'
      params.push(staleCutoff)
    } else if (verifyFilter === 'ok') {
      where += ' AND d.verified_at IS NOT NULL AND d.verified_at > 0 AND d.verified_at >= ?'
      params.push(staleCutoff)
    }
  }

  // ── 业务属性与发布者类型（两个视图都吃；UI 目前只在「已失效」面板暴露这些控件）──
  if (categoryFilter) {
    where += ' AND d.category = ?'
    params.push(categoryFilter)
  }
  if (qualityFilter) {
    where += ' AND d.quality = ?'
    params.push(qualityFilter)
  }
  if (regionFilter) {
    where += ' AND d.region = ?'
    params.push(regionFilter)
  }
  if (sourceFilter) {
    where += ' AND d.source_tag = ?'
    params.push(sourceFilter)
  }
  // 游客通告落库 user_id = 0（种子系统用户 `_system`），故按 0 分界
  if (originFilter === 'guest') where += ' AND d.user_id = 0'
  else if (originFilter === 'user') where += ' AND d.user_id > 0'
  // 失效原因：**只在失效面板有意义**（队列里的行没有失效原因，加上只会恒为空集），
  // 但它属于「筛选条上的一个筛选」而不是「分档」，所以算进 where —— 这样 chip 数字
  // 会跟着它一起变，不会出现「chip 说 15、列表说 2」的自相矛盾。
  if (view === 'invalid' && reasonFilter) {
    where += " AND COALESCE(d.invalid_reason, '') = ?"
    params.push(reasonFilter)
  }

  if (search) {
    const escaped = escapeLike(search)
    where += ` AND (d.provider LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\')`
    const like = `%${escaped}%`
    params.push(like, like)
  }

  // ── 生命周期这一维：只叠在失效面板的**列表**上，不进 where ──
  //
  // 分档计数按定义不能吃它（「已过期」档的条数不该被当前正开着的「已删除」档抹掉），
  // 所以两者必须分开拼。这一维目前不带占位符，故没有对应的 params。
  let lifecycleWhere = ''

  if (view === 'invalid') {
    // 已失效面板：三类合流（过期项不依赖归档是否跑过，按 expires_at 兜住）
    lifecycleWhere += ` AND (${L.deleted} OR ${L.invalid} OR ${L.expired})`
    if (lifecycle === 'deleted') lifecycleWhere += ` AND ${L.deleted}`
    else if (lifecycle === 'invalid') lifecycleWhere += ` AND ${L.invalid}`
    else if (lifecycle === 'expired') lifecycleWhere += ` AND ${L.expired}`
  }

  // 列表口径 = 业务筛选 + 生命周期；占位符顺序必须与条件拼接顺序一致
  const listWhere = where + lifecycleWhere

  const total = (db.prepare(`SELECT COUNT(*) AS total FROM token_deals d WHERE ${listWhere}`)
    .get(...params) as { total: number }).total

  const rows = db.prepare(`
    SELECT d.*, u.username,
      CASE WHEN d.guest_name IS NOT NULL AND d.guest_name != '' THEN d.guest_name ELSE u.nickname END AS nickname
    FROM token_deals d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE ${listWhere}
    ORDER BY d.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  // ── 计数 ──
  // 队列计数（待审 / 已发布 / 驳回 / 全部）只算在架条目，与队列视图同口径；
  // 「已失效」三类各自单列，三类之和 = invalid_total = 已失效面板总数。
  const C = lifecyclePreds('', now)
  const countRows = db.prepare(`
    SELECT state AS status, COUNT(*) AS count FROM token_deals
    WHERE ${C.live} GROUP BY state
  `).all() as { status: string; count: number }[]

  // 2026-11-04：键名改用 state（pending/verified/published/...），
  // 不再有 'approved' —— 那个概念已拆成 verified（已审核）与 published（已发布）。
  const counts: Record<string, number> = {
    pending: 0, verified: 0, published: 0, rejected: 0, all: 0,
    expired: 0, invalid: 0, deleted: 0, invalid_total: 0, stale: 0,
  }
  for (const row of countRows) {
    counts[row.status] = row.count
    counts.all += row.count
  }

  const lifeCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN ${C.deleted} THEN 1 ELSE 0 END) AS deleted,
      SUM(CASE WHEN ${C.invalid} THEN 1 ELSE 0 END) AS invalid,
      SUM(CASE WHEN ${C.expired} THEN 1 ELSE 0 END) AS expired
    FROM token_deals
  `).get() as { deleted: number | null; invalid: number | null; expired: number | null } | undefined

  // 待核验计数：口径必须与「待核验」tab 完全一致（tab 固定 status=approved），
  // 否则角标数字会和点进去的条数对不上
  const staleCount = (db.prepare(`
    SELECT COUNT(*) AS c FROM token_deals d
    WHERE ${L.live} AND d.state = 'published'
      AND (d.verified_at IS NULL OR d.verified_at = 0 OR d.verified_at < ?)
  `).get(now - verifyStaleDays() * 86400000) as { c: number } | undefined)?.c || 0
  counts.stale = staleCount

  counts.deleted = lifeCounts?.deleted || 0
  counts.invalid = lifeCounts?.invalid || 0
  counts.expired = lifeCounts?.expired || 0
  counts.invalid_total = counts.deleted + counts.invalid + counts.expired

  // 「已失效」面板的分档计数：吃同一批**业务筛选**、但**不吃生命周期这一维** ——
  // 与列表（listWhere）的差别恰好是少了当前选中的那一档，这正是 chip 的语义。
  // 队列视图不算（省一次全表 CASE 扫描），那时前端也拿不到这份数据。
  let lifecycleCounts: { all: number, expired: number, invalid: number, deleted: number } | null = null
  if (view === 'invalid') {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS all_count,
        SUM(CASE WHEN ${L.deleted} THEN 1 ELSE 0 END) AS deleted,
        SUM(CASE WHEN ${L.invalid} THEN 1 ELSE 0 END) AS invalid,
        SUM(CASE WHEN ${L.expired} THEN 1 ELSE 0 END) AS expired
      FROM token_deals d
      WHERE ${where} AND (${L.deleted} OR ${L.invalid} OR ${L.expired})
    `).get(...params) as {
      all_count: number
      deleted: number | null
      invalid: number | null
      expired: number | null
    } | undefined
    // SUM 在零行时返回 NULL（COUNT 不会），故一律 `|| 0` 归一
    lifecycleCounts = {
      all: row?.all_count || 0,
      expired: row?.expired || 0,
      invalid: row?.invalid || 0,
      deleted: row?.deleted || 0,
    }
  }

  return {
    view,
    deals: rows.map(row => ({
      ...row,
      models: parseModels(row.models),
      is_expired: !!row.expires_at && row.expires_at < now,
      lifecycle: classify(row, now),
      // 核验新鲜度由服务端按配置判定（前端别再自己算阈值，否则改配置就两套口径）
      verify_stale: isVerifyStale(row, now),
      verify_age_days: verifyAgeDays(row, now),
      invalid_reason_label: row.invalid_at
        ? (INVALID_REASON_LABELS[row.invalid_reason] || '已失效')
        : '',
    })),
    counts,
    // 「已失效」面板三档计数（吃当前业务筛选）；非 invalid 视图为 null
    lifecycle_counts: lifecycleCounts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
})
