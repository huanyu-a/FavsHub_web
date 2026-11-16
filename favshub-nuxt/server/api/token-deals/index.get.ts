/**
 * GET /api/token-deals — Token 白嫖通告列表
 * Query: page, limit, search, region, quality, source_tag, category, stale, verified, featured,
 *        exclude, sort (latest|nexus|hot|rating|expiring|verified), mine
 *
 * `stale=1` 只返回「待复核」条目（超过 deal_verify_stale_days 没人工核验，含从未核验）。
 * `verified=1` 只返回「近期已核实」条目（verified_at 非空且未超同一阈值）—— 与 `stale=1` 互补。
 * `featured=1` 只返回 `featured=1` 的精选条目（仍须 approved + 可见，绝不放宽可见性）。
 * `exclude=<dealId>` 排除指定 id（详情页「相关推荐」用）。
 * `sort=verified` 把最近核验过的排前面（未核验的垫底）。
 *
 * **`source_url` 任何身份都不下发**（运营字段，见下方剔除逻辑）。
 *
 * **默认排序 `latest`**（2026-10-30 需求：「/tokens 默认按最新排序」，此前默认 `nexus`）：
 * 置顶 → 最新发布。全站列表此前一进来是「Nexus 接入优先」，新通告容易被压在后面，
 * 与「通告板看新货」的使用预期相反；排序偏好是用户自己的事，故改为**显式传 `sort=nexus` 才用**。
 *
 * `sort=nexus`：置顶 → 已接入 Nexus 且启用 → 已接入但禁用 → 未接入，
 * 同档内按评测可用率降序、平均耗时升序。数据来自 `nexus_channels` / `nexus_deal_map`
 * （由定时同步任务写入，见 scripts/sync-nexus.mjs）。
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'
import {
  escapeLike, isVerifyStale as isVerifyStaleRow, parseFaq, publicVisibleClause,
  verifyAgeDays, verifyStaleDays,
} from '../../utils/token-deals'
import {
  hotOrder, occupiesPinnedSlot, pinnedOrderPrefix, pinnedRankQuery,
} from '../../utils/pinned-rank'

function parseModels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Nexus 优先级排序（默认排序）：
 *   1. 置顶条目恒在最前
 *   2. 接入档位：已接入且启用(0) < 已接入但禁用(1) < 未接入(2)
 *   3. 评测可用率降序（无评测数据记 -1，垫底）
 *   4. 平均耗时升序（无数据记哨兵值，垫底）
 *   5. 创建时间倒序
 */
const NEXUS_ORDER = [
  // 置顶位：与其它排序同源（每分类热度前 3）。原先这里是 `d.pinned DESC`，
  // 会把所有置顶条目全堆到最前 —— 与 2026-11-16 的新口径不一致，故一并改掉。
  pinnedOrderPrefix(),
  'CASE WHEN m.channel_id IS NULL THEN 2 WHEN n.status = 1 THEN 0 ELSE 1 END ASC',
  'CASE WHEN n.eval_total > 0 THEN CAST(n.eval_ok AS REAL) / n.eval_total ELSE -1 END DESC',
  'CASE WHEN n.eval_avg_ms > 0 THEN n.eval_avg_ms ELSE 999999999 END ASC',
  'd.created_at DESC',
].join(', ')

const NEXUS_SELECT = [
  'n.channel_id AS nexus_channel_id',
  'n.name AS nexus_name',
  'n.status AS nexus_status',
  'n.eval_ok AS nexus_eval_ok',
  'n.eval_total AS nexus_eval_total',
  'n.eval_avg_ms AS nexus_eval_avg_ms',
  'n.eval_at AS nexus_eval_at',
].join(', ')

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const query = getQuery(event)

  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 24))
  const offset = (page - 1) * limit
  const search = String(query.search || '').trim()
  const region = String(query.region || '').trim()
  const quality = String(query.quality || '').trim()
  const sourceTag = String(query.source_tag || '').trim()
  const category = String(query.category || '').trim()
  // 默认「最新」：需求「/tokens 默认按最新排序」。nexus 排序改为显式传参才生效（见文件头说明）。
  const sort = String(query.sort || 'latest')
  const mine = query.mine === '1' || query.mine === 'true'
  const staleOnly = query.stale === '1' || query.stale === 'true'
  // 近期已核实（2026-11-04）：只留 verified_at 非空且未超「待复核」阈值的条目。
  // 与 `stale=1` 恰好互补，但两者都只是**附加过滤**，叠加也合法（结果是空集）。
  const verifiedOnly = query.verified === '1' || query.verified === 'true'
  // 精选对比（2026-11-04）：只留 featured=1。仍需 approved + 可见（与公开侧同口径）
  const featuredOnly = query.featured === '1' || query.featured === 'true'
  // 详情页「相关推荐」用：排除当前条目，避免把自己推荐给自己
  const exclude = String(query.exclude || '').trim()

  const db = getRawDb()

  // Nexus 表由 createNexusSchema 建立；旧库尚未迁移时降级为无 Nexus 排序，不阻断列表
  const hasNexus = !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nexus_deal_map'"
  ).get()

  const joinClause = hasNexus
    ? 'LEFT JOIN nexus_deal_map m ON m.deal_id = d.id'
      + ' LEFT JOIN nexus_channels n ON n.channel_id = m.channel_id'
    : ''
  const nexusSelect = hasNexus ? `, ${NEXUS_SELECT}` : ''

  let whereClause: string
  const params: any[] = []

  if (mine) {
    if (!user) {
      throw createError({ statusCode: 401, data: { error: '未登录' } })
    }
    // 「我的通告」保留过期 / 失效条目（作者要能看见以便续期或申诉），但自己已删除的不再显示
    whereClause = 'd.user_id = ? AND d.deleted_at IS NULL'
    params.push(user.id)
  } else {
    // 公开列表：只认 state='published'（2026-11-04 收敛）+ 未过期。
    // 注意「已审核(verified)」不在其中 —— 审过不等于上线，这是本次状态机的核心口径。
    whereClause = '1=1'
    whereClause += publicVisibleClause('d', params)
  }

  if (search) {
    const escaped = escapeLike(search)
    whereClause += ` AND (d.provider LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\'`
      + ` OR d.quota LIKE ? ESCAPE '\\' OR d.note LIKE ? ESCAPE '\\' OR d.models LIKE ? ESCAPE '\\'`
      + ` OR d.summary LIKE ? ESCAPE '\\')`
    const like = `%${escaped}%`
    params.push(like, like, like, like, like, like)
  }
  if (region) {
    whereClause += ' AND d.region = ?'
    params.push(region)
  }
  if (quality) {
    whereClause += ' AND d.quality = ?'
    params.push(quality)
  }
  if (category) {
    whereClause += ' AND d.category = ?'
    params.push(category)
  }
  if (sourceTag) {
    whereClause += ' AND d.source_tag = ?'
    params.push(sourceTag)
  }
  if (staleOnly) {
    // 待复核：从未核验（0/NULL）或超过阈值没核验。只影响「提示」，不影响可见性
    whereClause += ' AND (d.verified_at IS NULL OR d.verified_at = 0 OR d.verified_at < ?)'
    params.push(Date.now() - verifyStaleDays() * 86400000)
  }
  if (verifiedOnly) {
    // 近期已核实：`verified_at` 非空且非 0（0 = 从未核验，见 CLAUDE.md「人工核验时间轴」），
    // 且在 `deal_verify_stale_days` 窗口内。窗口两端都用参数绑定（不字符串插值），
    // 避免 `verified_at = 0` 那类边界值被 `>= 0` 误判成「已核实」。
    const since = Date.now() - verifyStaleDays() * 86400000
    whereClause += ' AND d.verified_at IS NOT NULL AND d.verified_at != 0 AND d.verified_at >= ?'
    params.push(since)
  }
  if (featuredOnly) {
    // 精选对比：仍叠加在 publicVisibleClause 之上 —— 绝不因为「精选」就放宽可见性
    whereClause += ' AND d.featured = 1'
  }
  if (exclude) {
    // 排除指定 id（详情页「相关推荐」）。`<>` 而非 `NOT IN`：单值，且 NULL 安全
    whereClause += ' AND d.id != ?'
    params.push(exclude)
  }

  // ── 置顶位（2026-11-16）：每个页面取热度最高的 3 个 ──────────────────
  //
  // 原来这里是 `d.pinned DESC, ...`：管理员置顶过的条目**全部**堆在最前
  // （线上曾有 7 条同时置顶，等于没有置顶位）。现在改为：
  //   候选池 = pinned = 1 的条目
  //   排名   = 在**当前筛选范围**内按投票净分（vote_up - vote_down）从高到低
  //   生效   = 只有前 3 名占住置顶位，其余落回普通排序
  //
  // 排名用 SQL 窗口函数在**同一条 SQL** 里算完，再排序、再分页 ——
  // 若先查出来在内存里排，第 2 页会重新从 1 开始数，置顶位会在第 2 页又冒出来一遍。
  //
  // ⚠️ 排名 CTE 的 WHERE 必须与主查询的 whereClause **完全一致**（同一批筛选、
  // 同一个可见性口径），否则「置顶位」与「列表里实际看到的条目」对不上。
  // 这条约束同时决定了「每页 3 个」的语义：分类页带 category 筛选 → 该分类取 3 个；
  // /tokens 首页不带分类筛选 → 全站取 3 个（见 utils/pinned-rank.ts 的说明）。
  const rankCte = `pr AS (${pinnedRankQuery(whereClause)})`

  const defaultOrder = `${pinnedOrderPrefix()}, d.created_at DESC`
  // 起点即「最新」：只有**显式** sort=nexus（且 Nexus 表已迁移）才切到 Nexus 优先。
  // 这样未知 / 拼错的 sort 值退回默认，而不是悄悄给出另一种排序（与「默认最新」自述一致）。
  let orderClause = sort === 'nexus' && hasNexus ? NEXUS_ORDER : defaultOrder
  if (sort === 'latest') {
    orderClause = defaultOrder
  } else if (sort === 'hot') {
    // 热度排序：置顶位优先，其余按净分降序（与 pinned-rank 的热度口径同源）
    orderClause = `${pinnedOrderPrefix()}, ${hotOrder('d')}`
  } else if (sort === 'rating') {
    orderClause = `${pinnedOrderPrefix()}, (CASE WHEN d.rating_count > 0 THEN CAST(d.rating_sum AS REAL) / d.rating_count ELSE 0 END) DESC, d.rating_count DESC`
  } else if (sort === 'verified') {
    // 最近核验优先：从未核验的垫底，其余按核验时间倒序
    orderClause = `${pinnedOrderPrefix()}, (d.verified_at IS NULL OR d.verified_at = 0) ASC, d.verified_at DESC, d.created_at DESC`
  } else if (sort === 'expiring') {
    // 永久有效（expires_at 为空）排在最后，其余按到期时间升序
    orderClause = `${pinnedOrderPrefix()}, (d.expires_at IS NULL) ASC, d.expires_at ASC`
  }

  const total = (db.prepare(`SELECT COUNT(*) AS total FROM token_deals d WHERE ${whereClause}`)
    .get(...params) as { total: number }).total

  const rows = db.prepare(`
    WITH ${rankCte}
    SELECT d.*,
      pr.pinned_rank AS pinned_rank,
      CASE WHEN d.guest_name IS NOT NULL AND d.guest_name != '' THEN d.guest_name ELSE u.nickname END AS nickname${nexusSelect}
    FROM token_deals d
    LEFT JOIN users u ON d.user_id = u.id
    ${joinClause}
    LEFT JOIN pr ON pr.id = d.id
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ? OFFSET ?
  `)
    // ⚠️ params 要传**两遍**：`whereClause` 在 SQL 里出现了两次
    // （排名 CTE 一次、主查询一次），占位符因此也是两倍。
    // 只传一遍会让参数整体错位 —— 前几个条件被喂给 CTE 之后，
    // 主查询拿到的是错位的值，表现为「筛选莫名其妙不生效」而不是报错。
    // 顺序：CTE 的占位符在最前（WITH 子句先于主查询），然后主查询的，最后 LIMIT/OFFSET。
    .all(...params, ...params, limit, offset) as any[]

  const deals = rows.map((row) => {
    const {
      nexus_channel_id, nexus_name, nexus_status, nexus_eval_ok,
      nexus_eval_total, nexus_eval_avg_ms, nexus_eval_at, pinned_rank, ...rest
    } = row

    const nexus = nexus_channel_id != null
      ? {
          channel_id: nexus_channel_id,
          name: nexus_name,
          status: nexus_status,
          enabled: nexus_status === 1,
          eval_ok: nexus_eval_ok || 0,
          eval_total: nexus_eval_total || 0,
          eval_avg_ms: nexus_eval_avg_ms || 0,
          eval_at: nexus_eval_at || 0,
        }
      : null

    const now = Date.now()
    return {
      ...rest,
      models: parseModels(row.models),
      // 置顶位（2026-11-16）：下发的 `pinned` 改成「**实际占住置顶位**」，
      // 而不是数据库里的开关值。候选池里排名 4~7 的条目仍然是 pinned=1，
      // 但它们没有占住置顶位 —— 卡片画图钉、加「已置顶」底色都依据这个字段，
      // 若照旧下发 1，它们会散在列表中间却带着图钉，看起来像置顶失效。
      pinned: occupiesPinnedSlot(pinned_rank) ? 1 : 0,
      // 分类内置顶排名（内部用，不下发）：1 = 该分类里热度最高的那条
      pinned_rank: undefined,
      // FAQ 是 JSON 字符串列 → 公开侧一律下发解析后的数组（前端拿到的永远是 [{q,a}]）。
      // `parseFaq` 对脏数据（非法 JSON / 非数组 / 缺字段）回 `[]`，不会 500。
      faq: parseFaq(row.faq),
      // 精选对比：归一为 0/1 整数（SQLite 里可能存 0/1/NULL）
      featured: row.featured ? 1 : 0,
      is_expired: !!row.expires_at && row.expires_at < now,
      is_invalid: !!row.invalid_at,
      // 走到这里的公开行一定可见（SQL 已过滤），mine=1 时才可能为 true
      is_hidden: !!row.deleted_at || !!row.invalid_at || (!!row.expires_at && row.expires_at < now),
      // 人工核验时间轴（2026-10-20）：核验人只下发到后台，公开列表不带
      verified_at: Number(row.verified_at || 0),
      verify_age_days: verifyAgeDays(row, now),
      verify_stale: isVerifyStaleRow(row, now),
      verify_note: String(row.verify_note || ''),
      verified_by: undefined,
      // 2026-10-30 前端脱敏：内部标识与下架操作人不进公开列表
      user_id: undefined,
      deleted_by: undefined,
      // 游客指纹不下发（与详情同口径）：它是同一匿名访客的跨通告关联键，
      // 公开侧只保留游客自填的 guest_name
      guest_fingerprint: undefined,
      // 生命周期原始列不下发公开列表（2026-10-30 四轮）：
      // 前端只需要派生值 `is_hidden`（= deleted || invalid || expired），
      // 原始列是运营侧审计信息 —— 「谁在何时删的」「为什么判失效」。
      // 公开列表的 SQL 已过滤掉不可见行，所以这两个字段今天就恒为空，
      // 但那是**偶然安全**；详情端点本轮已同样剔除，两处必须同口径。
      // ⚠️ `reject_reason` **刻意保留**（与详情同口径）：`mine=1` 时作者要看到
      //    自己被驳回的原因才能改稿重提。
      deleted_at: undefined,
      invalid_reason: undefined,
      // ⚠️ **情报来源 source_url：任何身份都不下发**（含管理员浏览公开前台）。
      //    2026-11-04 新增列，属运营留痕（对标站点的详情页地址）——
      //    公开侧用 `...rest` 展开全列，所以每加一个内部列都必须回到这里显式剔除。
      //    与 `verified_by` / `guest_fingerprint` / `deleted_by` 同一份口径；
      //    `ai-service.ts` 的 `DEAL_PRIVATE_FIELDS` 也同步加了它（AI 通道同样不下发）。
      source_url: undefined,
      nexus,
    }
  })

  return {
    deals,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
})
