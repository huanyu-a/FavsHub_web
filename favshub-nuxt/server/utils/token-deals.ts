/**
 * Token 白嫖通告 — 共享常量、输入校验与统计同步
 *
 * 品质分级（五档）与来源标签沿用「AI 资源导航」站点的体系；
 * 可用性投票与综合评分沿用「FreeBuddy 免费模型专区」的社区健康度模型。
 */
import type Database from 'better-sqlite3'

/** 品质分级 — 上上品 → 下下品 */
export const QUALITY_LEVELS = ['上上品', '上品', '中品', '下品', '下下品'] as const
export type QualityLevel = (typeof QUALITY_LEVELS)[number]

/** 访问区域 — 国内直连 / 海外（海外通常需要代理） */
export const REGIONS = ['cn', 'global'] as const
export const REGION_LABELS: Record<string, string> = {
  cn: '国内直连',
  global: '海外',
}

/** 来源标签 — 官方直营 / 中转站 / 社区转发 */
export const SOURCE_TAGS = ['official', 'relay', 'community'] as const
export const SOURCE_LABELS: Record<string, string> = {
  official: '官方直营',
  relay: '中转站',
  community: '社区转发',
}

/** 通告状态 — 发布后进入 pending，管理员审核通过才公开 */
export const DEAL_STATUS = ['pending', 'approved', 'rejected'] as const

/** 字段长度上限 */
export const LIMITS = {
  provider: 60,
  title: 120,
  url: 500,
  callUrl: 500,
  quota: 200,
  note: 500,
  models: 20,
  modelName: 60,
  reviewContent: 1000,
} as const

/** 是否为合法的 http(s) 地址 */
export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** 转义 LIKE 通配符，防止搜索关键词注入 */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}

/** 归一化模型数组：去空、去重、截断长度 */
export function normalizeModels(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    const name = String(raw ?? '').trim().slice(0, LIMITS.modelName)
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
    if (out.length >= LIMITS.models) break
  }
  return out
}

export interface DealPayload {
  provider: string
  title: string
  url: string
  callUrl: string
  quota: string
  models: string[]
  region: string
  quality: QualityLevel
  sourceTag: string
  expiresAt: number | null
  note: string
}

export type ValidateResult =
  | { ok: true; data: DealPayload }
  | { ok: false; error: string }

/**
 * 校验并归一化通告提交数据。
 * 只做字段级校验，权限与状态流转由各端点负责。
 */
export function validateDealPayload(body: any): ValidateResult {
  const provider = String(body?.provider ?? '').trim()
  if (!provider) return { ok: false, error: '服务商名称不能为空' }
  if (provider.length > LIMITS.provider) return { ok: false, error: `服务商名称不能超过 ${LIMITS.provider} 字` }

  const title = String(body?.title ?? '').trim()
  if (!title) return { ok: false, error: '通告标题不能为空' }
  if (title.length > LIMITS.title) return { ok: false, error: `通告标题不能超过 ${LIMITS.title} 字` }

  const url = String(body?.url ?? '').trim()
  if (!url) return { ok: false, error: '领取地址不能为空' }
  if (!isHttpUrl(url)) return { ok: false, error: '领取地址必须是合法的 http(s) 链接' }
  if (url.length > LIMITS.url) return { ok: false, error: `领取地址不能超过 ${LIMITS.url} 字` }

  const callUrl = String(body?.call_url ?? body?.callUrl ?? '').trim()
  if (callUrl && !isHttpUrl(callUrl)) return { ok: false, error: 'API 调用地址必须是合法的 http(s) 链接' }
  if (callUrl.length > LIMITS.callUrl) return { ok: false, error: `API 调用地址不能超过 ${LIMITS.callUrl} 字` }

  const quota = String(body?.quota ?? '').trim()
  if (quota.length > LIMITS.quota) return { ok: false, error: `免费额度不能超过 ${LIMITS.quota} 字` }

  const note = String(body?.note ?? '').trim()
  if (note.length > LIMITS.note) return { ok: false, error: `备注不能超过 ${LIMITS.note} 字` }

  const region = String(body?.region ?? 'cn')
  if (!REGIONS.includes(region as any)) return { ok: false, error: '访问区域取值非法' }

  const quality = String(body?.quality ?? '中品')
  if (!QUALITY_LEVELS.includes(quality as any)) return { ok: false, error: '品质分级取值非法' }

  const sourceTag = String(body?.source_tag ?? body?.sourceTag ?? 'official')
  if (!SOURCE_TAGS.includes(sourceTag as any)) return { ok: false, error: '来源标签取值非法' }

  let expiresAt: number | null = null
  const rawExpires = body?.expires_at ?? body?.expiresAt
  if (rawExpires !== null && rawExpires !== undefined && rawExpires !== '') {
    const num = Number(rawExpires)
    if (!Number.isFinite(num) || num <= 0) return { ok: false, error: '有效期时间戳非法' }
    expiresAt = Math.floor(num)
  }

  return {
    ok: true,
    data: {
      provider,
      title,
      url,
      callUrl,
      quota,
      models: normalizeModels(body?.models),
      region,
      quality: quality as QualityLevel,
      sourceTag,
      expiresAt,
      note,
    },
  }
}

/**
 * 从投票 / 评测明细重算缓存计数并写回主表。
 * 不更新 updated_at —— 该字段语义为「内容更新时间」，投票不改变内容。
 */
export function syncDealCounters(db: Database.Database, dealId: string): void {
  const votes = db.prepare(`
    SELECT
      SUM(CASE WHEN vote = 'up' THEN 1 ELSE 0 END) AS up,
      SUM(CASE WHEN vote = 'down' THEN 1 ELSE 0 END) AS down
    FROM token_deal_votes WHERE deal_id = ?
  `).get(dealId) as { up: number | null; down: number | null }

  const reviews = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(rating), 0) AS sum
    FROM token_deal_reviews WHERE deal_id = ?
  `).get(dealId) as { count: number; sum: number }

  db.prepare(`
    UPDATE token_deals
    SET vote_up = ?, vote_down = ?, rating_sum = ?, rating_count = ?
    WHERE id = ?
  `).run(votes.up || 0, votes.down || 0, reviews.sum || 0, reviews.count || 0, dealId)
}

/** 判断通告是否已过有效期（expires_at 为空表示永久有效） */
export function isExpired(deal: { expires_at?: number | null }): boolean {
  const exp = deal?.expires_at
  if (!exp) return false
  return exp < Date.now()
}

/** 生成通告 ID */
export function newDealId(): string {
  return `deal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
