/**
 * GET /api/token-keys — 「福利 Key」公开脱敏列表（docs/08 §4.2 F3）
 * Query: page, limit, verdict, provider
 *
 * 红线（07 §8.5 / docs/08 §1.3）：
 *   - SELECT 列清单即白名单：key_encrypted / key_hash / error_message_raw
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

/** 白名单 14 字段 = SELECT 列清单；敏感列不在其列（docs/08 §4.2） */
const KEY_FIELDS = [
  'id', 'key_masked', 'verdict', 'confidence', 'provider', 'base_url', 'models', 'source',
  'source_id', 'source_tid', 'source_url', 'source_title', 'first_seen_at', 'last_probe_at',
].join(', ')

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

  // 恒定过滤 deal_status = 'published'——天然同时挡住 hidden（下架）与 pending（待审）
  let whereClause = "deal_status = 'published'"
  const params: any[] = []
  if (hasVerdict) {
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

  // 排序固定一条（docs/08 §4.2，照 local_server.py:1109 的实测排序）
  const rows = db.prepare(`
    SELECT ${KEY_FIELDS}
    FROM token_keys
    WHERE ${whereClause}
    ORDER BY (source = 'post') DESC, last_probe_at DESC, first_seen_at DESC, id
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  const keys = rows.map((row) => ({
    ...row,
    models: parseModels(row.models),
  }))

  // verdict_counts 恒为 published 全集口径，不受筛选参数影响（页面统计条用）
  const verdictCounts: Record<string, number> = {}
  const countRows = db.prepare(
    "SELECT verdict, COUNT(*) AS count FROM token_keys WHERE deal_status = 'published' GROUP BY verdict"
  ).all() as { verdict: string, count: number }[]
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
