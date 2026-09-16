/**
 * GET /api/token-deals — Token 白嫖通告列表
 * Query: page, limit, search, region, quality, source_tag, sort (nexus|latest|hot|rating|expiring), mine
 *
 * 默认排序为 `nexus`：置顶 → 已接入 Nexus 且启用 → 已接入但禁用 → 未接入，
 * 同档内按评测可用率降序、平均耗时升序。数据来自 `nexus_channels` / `nexus_deal_map`
 * （由定时同步任务写入，见 scripts/sync-nexus.mjs）。
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'
import { escapeLike } from '../../utils/token-deals'

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
  'd.pinned DESC',
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
  const sort = String(query.sort || 'nexus')
  const mine = query.mine === '1' || query.mine === 'true'

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
    whereClause = 'd.user_id = ?'
    params.push(user.id)
  } else {
    // 公开列表只展示审核通过的通告
    whereClause = "d.status = 'approved'"
  }

  if (search) {
    const escaped = escapeLike(search)
    whereClause += ` AND (d.provider LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\'`
      + ` OR d.quota LIKE ? ESCAPE '\\' OR d.note LIKE ? ESCAPE '\\' OR d.models LIKE ? ESCAPE '\\')`
    const like = `%${escaped}%`
    params.push(like, like, like, like, like)
  }
  if (region) {
    whereClause += ' AND d.region = ?'
    params.push(region)
  }
  if (quality) {
    whereClause += ' AND d.quality = ?'
    params.push(quality)
  }
  if (sourceTag) {
    whereClause += ' AND d.source_tag = ?'
    params.push(sourceTag)
  }

  const defaultOrder = 'd.pinned DESC, d.created_at DESC'
  let orderClause = hasNexus ? NEXUS_ORDER : defaultOrder
  if (sort === 'latest') {
    orderClause = defaultOrder
  } else if (sort === 'hot') {
    orderClause = 'd.pinned DESC, (d.vote_up - d.vote_down) DESC, d.vote_up DESC, d.created_at DESC'
  } else if (sort === 'rating') {
    orderClause = 'd.pinned DESC, (CASE WHEN d.rating_count > 0 THEN CAST(d.rating_sum AS REAL) / d.rating_count ELSE 0 END) DESC, d.rating_count DESC'
  } else if (sort === 'expiring') {
    // 永久有效（expires_at 为空）排在最后，其余按到期时间升序
    orderClause = 'd.pinned DESC, (d.expires_at IS NULL) ASC, d.expires_at ASC'
  }

  const total = (db.prepare(`SELECT COUNT(*) AS total FROM token_deals d WHERE ${whereClause}`)
    .get(...params) as { total: number }).total

  const rows = db.prepare(`
    SELECT d.*, u.username, u.nickname${nexusSelect}
    FROM token_deals d
    LEFT JOIN users u ON d.user_id = u.id
    ${joinClause}
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  const deals = rows.map((row) => {
    const {
      nexus_channel_id, nexus_name, nexus_status, nexus_eval_ok,
      nexus_eval_total, nexus_eval_avg_ms, nexus_eval_at, ...rest
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

    return {
      ...rest,
      models: parseModels(row.models),
      is_expired: !!row.expires_at && row.expires_at < Date.now(),
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
