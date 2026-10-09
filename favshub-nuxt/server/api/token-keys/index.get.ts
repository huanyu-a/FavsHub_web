/**
 * GET /api/token-keys — 「福利 Key」公开列表（docs/08 §4.2 F3）
 * Query: page, limit, verdict, provider
 *
 * 2026-10-08 设计变更（站点方需求，二次调整后口径）：
 *   - 明文 key **不进列表响应**：完整 key 只能经「复制」按钮从
 *     GET /api/token-keys/:id/copy 按需获取 —— 卡面只渲染脱敏形态，且 SSR
 *     payload（__NUXT_DATA__）同样不含明文；
 *   - dead 行不再返回（爬虫侧每轮 prune 对账清理 + 此处恒过滤双保险）；
 *   - 回帖指引行只返回收录 24h 内的（与爬虫 TTL 双保险）；
 *   - post_time（原帖发帖时间原文字符串）随行返回。
 *
 * 红线（07 §8.5 / docs/08 §1.3）：
 *   - SELECT 列清单即白名单：key_encrypted / key_hash / key_plain / error_message_raw
 *     （以及 note / consecutive_failures 等内部诊断列）根本不进 SELECT，
 *     绝不出现在任何返回、日志或错误信息中；
 *   - 恒定 WHERE deal_status = 'published'，无任何旁路（无 token-deals 的 mine
 *     分支——本表没有用户归属），hidden（下架）与 pending（待审）行永不外流。
 *
 * 鉴权：无（不调 optionalAuth——响应与登录态零相关，才允许 CDN 公开缓存）。
 * 缓存：Cache-Control: public, max-age=300 由 nuxt.config.ts routeRules 配置
 * （docs/08 §4.2），handler 内不设头，与 token-deals 模式一致。
 *
 * 时间戳为秒级（沿爬虫语义，与站点其余表的毫秒不同），页面渲染时 ×1000。
 * 本接口与建表（migrate.ts createTokenKeysSchema）同版本发布，不做
 * sqlite_master 降级探测——表缺失直接 500 暴露迁移失败（docs/08 §4.2）。
 */
import { getRawDb } from '../../database'
import { escapeLike } from '../../utils/token-deals'

/** verdict 枚举白名单（8 值，与 crawler 侧 VERDICTS / migrate.ts DDL 注释一致） */
const VERDICTS = [
  'valid', 'quota', 'limited', 'dead',
  'unknown', 'restricted', 'blocked_by_waf', 'endpoint_unsupported',
] as const

/** 白名单字段 = SELECT 列清单；key_encrypted / key_hash / key_plain 等敏感列不在其列 */
const KEY_FIELDS = [
  'id', 'key_masked', 'verdict', 'confidence', 'provider', 'base_url', 'models', 'source',
  'source_id', 'source_tid', 'source_url', 'source_title', 'first_seen_at', 'last_probe_at', 'post_time',
].join(', ')

/** 回帖指引行收录窗口（秒），与爬虫 prune_expired_guide_rows / push GUIDE_WINDOW_SECONDS 同值 */
const GUIDE_WINDOW_SECONDS = 24 * 3600

/** models 存 JSON 字符串；防御性解析（照 token-deals/index.get.ts 同名函数） */
function parseModels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default defineEventHandler((event) => {
  const query = getQuery(event)

  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 24))
  const offset = (page - 1) * limit

  // verdict 筛选：枚举白名单校验，非法值忽略（docs/08 §4.2）
  const verdict = String(query.verdict || '').trim()
  const hasVerdict = (VERDICTS as readonly string[]).includes(verdict)
  const provider = String(query.provider || '').trim()

  const db = getRawDb()

  // 恒定过滤：published（挡 hidden/pending）+ 非 dead（失效清理后不外流）+
  // guide 行 24h 窗口（与爬虫清理双保险，即使清理延迟页面也不出现过期指引）
  const guideCutoff = Math.floor(Date.now() / 1000) - GUIDE_WINDOW_SECONDS
  let whereClause = "deal_status = 'published' AND verdict != 'dead'"
  whereClause += " AND (source != 'reply_visible_guide' OR first_seen_at > ?)"
  const params: any[] = [guideCutoff]
  if (hasVerdict) {
    // dead 已被恒定过滤排除——显式筛选 dead 恒为空（页面下拉也不提供该项）
    whereClause += ' AND verdict = ?'
    params.push(verdict)
  }
  if (provider) {
    // LIKE 通配符经 escapeLike 转义（照 token-deals/index.get.ts 写法）
    whereClause += " AND provider LIKE ? ESCAPE '\\'"
    params.push(`%${escapeLike(provider)}%`)
  }

  const total = (db.prepare(`SELECT COUNT(*) AS total FROM token_keys WHERE ${whereClause}`)
    .get(...params) as { total: number }).total

  // 排序固定一条（docs/08 §4.2）：B 类（post）优先于指引；verdict 权重把「确认可用」
  // 的行排到最前（看板的核心诉求是拿到能用的 key），同级再按收录时间倒序
  const rows = db.prepare(`
    SELECT ${KEY_FIELDS}
    FROM token_keys
    WHERE ${whereClause}
    ORDER BY (source = 'post') DESC,
      CASE verdict WHEN 'valid' THEN 0 WHEN 'quota' THEN 1 WHEN 'limited' THEN 2 ELSE 3 END,
      first_seen_at DESC, id
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  // base_url 服务端统一遮蔽 key 形态片段（与前端 displayBaseUrl 同一正则规则）：
  // 部分站点把 key 直接写进 API 地址（URL 即 key），若原样返回，完整 key 会经
  // Nuxt payload（__NUXT_DATA__）进入页面源码。完整 URL 只经
  // GET /api/token-keys/:id/copy 按需下发（该端点现随 key_plain 一并返回 base_url）。
  const KEY_LIKE_RE = /\b[A-Za-z0-9_\-]*(?:sk-|gsk_|xai-|fw_|hf_|pplx-|nvapi-|csk-|r8_)[A-Za-z0-9_\-]{8,}/g
  const keys = rows.map((row) => ({
    ...row,
    models: parseModels(row.models),
    base_url: String(row.base_url || '').replace(KEY_LIKE_RE, (m: string) =>
      m.length <= 18 ? m : `${m.slice(0, 6)}…${m.slice(-4)}`),
  }))

  // verdict_counts 恒为「已展示口径」全集（published、非 dead、guide 24h 内），
  // 不受筛选参数影响（页面统计条用），与列表可见行保持一致
  const verdictCounts: Record<string, number> = {}
  const countRows = db.prepare(
    "SELECT verdict, COUNT(*) AS count FROM token_keys"
    + " WHERE deal_status = 'published' AND verdict != 'dead'"
    + " AND (source != 'reply_visible_guide' OR first_seen_at > ?)"
    + " GROUP BY verdict",
  ).all(guideCutoff) as { verdict: string, count: number }[]
  for (const row of countRows) {
    verdictCounts[row.verdict] = row.count
  }

  return {
    keys,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    verdict_counts: verdictCounts,
  }
})
