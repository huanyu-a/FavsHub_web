/**
 * Token 白嫖通告 — 共享常量、输入校验与统计同步
 *
 * 品质分级（五档）与来源标签沿用「AI 资源导航」站点的体系；
 * 可用性投票与综合评分沿用「FreeBuddy 免费模型专区」的社区健康度模型。
 */
import type Database from 'better-sqlite3'
import { appendDealEvent, deleteDealEvents } from './deal-events'
import { getRawDb } from '../database'
import { notifyTokenDealApproved, notifyTokenDealRejected } from './qq-notify'

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
  /** 登录用户评测限频（每用户每小时）—— 补的是「批量注册 → 灌评测」这条路 */
  reviewPerUserPerHour: 20,
  /** 登录用户评测限频（每 IP 每小时）—— 多账号同源刷量兜底 */
  reviewPerIpPerHour: 40,
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

  // 游客投票：与登录投票合并计数（游客表缺失即未迁移时按 0 处理，不阻断主流程）
  let guestVotes = { up: 0, down: 0 }
  try {
    guestVotes = db.prepare(`
      SELECT
        SUM(CASE WHEN vote = 'up' THEN 1 ELSE 0 END) AS up,
        SUM(CASE WHEN vote = 'down' THEN 1 ELSE 0 END) AS down
      FROM token_deal_guest_votes WHERE deal_id = ?
    `).get(dealId) as { up: number | null; down: number | null }
  } catch { /* 表未迁移时忽略 */ }

  const reviews = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(rating), 0) AS sum
    FROM token_deal_reviews WHERE deal_id = ?
  `).get(dealId) as { count: number; sum: number }

  // 游客评测：**仅已通过审核的**计入评分（pending/rejected 不计），
  // 与「审核通过才公开」的语义一致。表缺失（未迁移）时按 0 处理，不阻断主流程。
  let guest = { count: 0, sum: 0 }
  try {
    guest = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(rating), 0) AS sum
      FROM token_deal_guest_reviews WHERE deal_id = ? AND status = 'approved'
    `).get(dealId) as { count: number; sum: number }
  } catch { /* 表未迁移时忽略 */ }

  db.prepare(`
    UPDATE token_deals
    SET vote_up = ?, vote_down = ?, rating_sum = ?, rating_count = ?
    WHERE id = ?
  `).run(
    (votes.up || 0) + (guestVotes.up || 0),
    (votes.down || 0) + (guestVotes.down || 0),
    (reviews.sum || 0) + (guest.sum || 0),
    (reviews.count || 0) + (guest.count || 0),
    dealId,
  )
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

/** 生成修改提案 ID */
export function newEditId(): string {
  return `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 安全解析库中的 models 字段（存的是 JSON 字符串） */
export function parseDealModels(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(String(raw ?? '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ════════════════════════════════════════════════════════════════
// 修改提案 — 字段级 patch
//
// 语义：任何登录用户都可对任意通告提交**字段级**修改建议（只带被改字段），
// 由「通告作者」或「管理员」审核；管理员可审核所有用户的提案。
// 提案通过时才把 patch 合并进主表 —— 提案期间主表内容不受影响。
// ════════════════════════════════════════════════════════════════

/** 提案可修改的字段白名单（不含 status / pinned / user_id / 计数列 —— 由权限与站点规则决定） */
export const DEAL_PATCHABLE = [
  'provider', 'title', 'url', 'call_url', 'quota', 'models',
  'region', 'quality', 'source_tag', 'expires_at', 'note',
] as const

/** 字段中文名，供 diff 展示 */
export const DEAL_FIELD_LABELS: Record<string, string> = {
  provider: '服务商',
  title: '通告标题',
  url: '领取地址',
  call_url: 'API 调用地址',
  quota: '免费额度',
  models: '支持模型',
  region: '访问区域',
  quality: '品质分级',
  source_tag: '来源标签',
  expires_at: '有效期',
  note: '备注',
}

/** snake_case → camelCase 别名（请求体两种写法都接受） */
const DEAL_FIELD_ALIASES: Record<string, string> = {
  call_url: 'callUrl',
  source_tag: 'sourceTag',
  expires_at: 'expiresAt',
}

/** 从请求体读取某字段，兼容 snake_case 与 camelCase；`present` 表示「显式出现」 */
export function readDealField(body: any, key: string): { present: boolean; value: any } {
  if (body?.[key] !== undefined) return { present: true, value: body[key] }
  const alias = DEAL_FIELD_ALIASES[key]
  if (alias && body?.[alias] !== undefined) return { present: true, value: body[alias] }
  return { present: false, value: undefined }
}

/**
 * 提取字段级 patch —— 只保留白名单内**显式出现**的字段。
 *
 * `present` 而非「值非空」是判据：`{ expires_at: null }` 是有意义的（清除有效期），
 * 必须与「未传」区分开。
 */
export function extractDealPatch(body: any): Record<string, any> {
  const patch: Record<string, any> = {}
  for (const key of DEAL_PATCHABLE) {
    const { present, value } = readDealField(body, key)
    if (present) patch[key] = value
  }
  return patch
}

/** 把库中一行通告摊平成与 patch 同形的对象（models 解成数组、expires_at 归一为 null） */
export function dealToPatchShape(deal: any): Record<string, any> {
  return {
    provider: deal?.provider,
    title: deal?.title,
    url: deal?.url,
    call_url: deal?.call_url,
    quota: deal?.quota,
    models: parseDealModels(deal?.models),
    region: deal?.region,
    quality: deal?.quality,
    source_tag: deal?.source_tag,
    expires_at: deal?.expires_at ?? null,
    note: deal?.note,
  }
}

/**
 * 以库中记录为底、用 patch 覆盖后**复用同一套校验**。
 *
 * 提案与直接编辑共用 `validateDealPayload`，避免「提案路径」与「编辑路径」的字段规则各自漂移。
 */
export function validateDealPatch(deal: any, patch: Record<string, any>): ValidateResult {
  const merged = { ...dealToPatchShape(deal), ...patch }
  return validateDealPayload(merged)
}

/** 把校验后的 DealPayload 收敛回 snake_case patch（只保留 keys 指定的字段） */
export function payloadToPatch(d: DealPayload, keys: Iterable<string>): Record<string, any> {
  const full: Record<string, any> = {
    provider: d.provider,
    title: d.title,
    url: d.url,
    call_url: d.callUrl,
    quota: d.quota,
    models: d.models,
    region: d.region,
    quality: d.quality,
    source_tag: d.sourceTag,
    expires_at: d.expiresAt,
    note: d.note,
  }
  const out: Record<string, any> = {}
  for (const k of keys) out[k] = full[k]
  return out
}

export interface DealFieldDiff {
  field: string
  label: string
  from: any
  to: any
}

/** 逐字段求差异（值语义比较，models 按数组比较）；无差异的字段不出现在结果里 */
export function diffDealPatch(deal: any, patch: Record<string, any>): DealFieldDiff[] {
  const current = dealToPatchShape(deal)
  const out: DealFieldDiff[] = []
  for (const key of DEAL_PATCHABLE) {
    if (!(key in patch)) continue
    const prev = current[key] ?? null
    const next = patch[key] ?? null
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      out.push({ field: key, label: DEAL_FIELD_LABELS[key] || key, from: prev, to: next })
    }
  }
  return out
}

/** 提案操作统一返回形状 —— 让 Web 端点（createError）与 AI 通道（fail）各自映射错误 */
export type EditOpResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }

/** 审核权限：通告作者或管理员（管理员可审核所有用户的提案） */
export function canReviewDeal(deal: { user_id: number }, viewer: { id: number; isAdmin: boolean }): boolean {
  return viewer.isAdmin || deal.user_id === viewer.id
}

// ════════════════════════════════════════════════════════════════
// 通告审核 — 共享写库 + 通知
//
// admin review 端点（POST /api/admin/token-deals/:id/review）与 QQ 机器人
// 「通过 / 驳回」指令共用同一套写库语义与 §B4 通知链路，避免逻辑复制。
// ════════════════════════════════════════════════════════════════

export type DealReviewAction = 'approve' | 'reject'

export type DealReviewResult =
  | { ok: true; deal: { id: string; user_id: number; title: string } }
  | { ok: false; status: number; error: string }

/**
 * 审核通告：approve → status='approved' 并清空 reject_reason；
 * reject → status='rejected' 并写入 reason（trim 后截断 200 字，与原端点语义一致）。
 * 写库成功后触发 QQ 机器人通知（群播 + 私聊作者），通知失败只告警不阻断。
 */
export function reviewDealById(dealId: string, action: DealReviewAction, reason: string): DealReviewResult {
  const db = getRawDb()
  const deal = db.prepare('SELECT * FROM token_deals WHERE id = ?')
    .get(dealId) as any
  if (!deal) return { ok: false, status: 404, error: '通告不存在' }

  const status = action === 'approve' ? 'approved' : 'rejected'
  const finalReason = action === 'reject' ? String(reason ?? '').trim().slice(0, 200) : ''
  db.prepare(
    'UPDATE token_deals SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?'
  ).run(status, finalReason, Date.now(), dealId)

  // 审核通过 = 对外「上新」（写入时仍受可见性约束：已删除 / 已失效 / 已过期则不入事件流）
  if (action === 'approve') {
    appendDealEvent(db, dealId, 'online', { before: deal })
  }

  try {
    if (action === 'approve') {
      notifyTokenDealApproved(deal.title, deal.user_id)
    } else {
      notifyTokenDealRejected(deal.title, deal.user_id, finalReason)
    }
  } catch (err: any) {
    console.warn('[QQBot] 通告审核通知入队失败（忽略）:', err?.message || err)
  }

  return { ok: true, deal }
}

// ════════════════════════════════════════════════════════════════
// 通告生命周期 —— 失效状态机 + 软删除
//
// ## 为什么要与 status 分开
//
// `status`（pending/approved/rejected）是**审核**状态，由人工流转；而「过期 / 失效 /
// 已删除」是**生命周期**状态，随时间与社区投票自动变化。两者混在一个字段里会互相覆盖
// （过期把 approved 改掉，就再也说不出「它曾经审核通过」），故新增独立列：
//
//   deleted_at / deleted_by   —— 软删除（可恢复），「被删除」从此可追溯
//   invalid_at / invalid_reason —— 失效（expired | votes | manual），非空即对外不可见
//
// ## 失效来源（三处写入）
//
//   1. expired —— `archiveExpiredDeals()` 把 `expires_at` 已过的 approved 行归档
//   2. votes   —— 投票否决阈值（`evaluateDealVoteInvalidation()`，仅在真实投票时评估）
//   3. manual  —— 管理员在后台「已失效」面板手动标记
//
// **不在 `syncDealCounters` 里评估投票阈值**：种子数据会灌入演示票，
// 若在计数重算时评估，首次启动就会把演示通告整批判为失效。
// ════════════════════════════════════════════════════════════════

/** 失效原因枚举 */
export const INVALID_REASONS = ['expired', 'votes', 'manual'] as const
export type InvalidReason = (typeof INVALID_REASONS)[number]

/** 失效原因中文标签（后台展示） */
export const INVALID_REASON_LABELS: Record<string, string> = {
  expired: '已过期',
  votes: '社区判定失效',
  manual: '管理员判定失效',
}

/**
 * 投票否决阈值：负票数下限 + 负票占比。
 *
 * 设绝对下限是**误杀保护** —— 一条刚发布的通告被 1 个人点了「已失效」不该消失；
 * 3 票 + 60% 是两个都满足才触发，宁可漏判（留给管理员手动），不可错杀。
 */
export const INVALID_VOTE_RULE = {
  /** 触发所需的最少负票数 */
  minDownVotes: 3,
  /** 负票占（正+负）的最低比例 */
  minDownRatio: 0.6,
} as const

/**
 * 公开可见口径（与 `status='approved'` 配合）：未删除 + 未失效 + 未过期。
 *
 * 过期在这里**运行时判一次**（而不只依赖归档任务），保证到点即不可见，
 * 不因归档任务未跑而漏出。params 按 `?` 出现顺序追加。
 */
export function publicVisibleClause(alias: string, params: any[], now = Date.now()): string {
  params.push(now)
  return ` AND ${alias}.deleted_at IS NULL AND ${alias}.invalid_at IS NULL`
    + ` AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)`
}

/** 单条通告是否对外可见（内存判断，供端点对已查出的行做二次校验） */
export function isPubliclyVisible(
  deal: { deleted_at?: number | null; invalid_at?: number | null; expires_at?: number | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!deal) return false
  if (deal.deleted_at) return false
  if (deal.invalid_at) return false
  if (deal.expires_at && deal.expires_at <= now) return false
  return true
}

/** 软删除：置 deleted_at，明细表（投票/评测/建议/打标）全部保留，可恢复 */
export function softDeleteDeal(db: Database.Database, dealId: string, actorId: number): boolean {
  const before = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId)
  const res = db.prepare(
    'UPDATE token_deals SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(Date.now(), actorId, Date.now(), dealId)
  if (res.changes > 0) appendDealEvent(db, dealId, 'offline', { reason: 'deleted', before })
  return res.changes > 0
}

/** 恢复软删除 */
export function restoreDeletedDeal(db: Database.Database, dealId: string): boolean {
  const before = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId)
  const res = db.prepare(
    'UPDATE token_deals SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL'
  ).run(Date.now(), dealId)
  if (res.changes > 0) appendDealEvent(db, dealId, 'online', { reason: 'restored', before })
  return res.changes > 0
}

/** 标记失效（管理员手动 / 过期归档 / 投票判定共用） */
export function markDealInvalid(
  db: Database.Database,
  dealId: string,
  reason: InvalidReason,
  at = Date.now(),
): boolean {
  const before = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId)
  const res = db.prepare(
    'UPDATE token_deals SET invalid_at = ?, invalid_reason = ?, updated_at = ? WHERE id = ? AND invalid_at IS NULL'
  ).run(at, reason, Date.now(), dealId)
  if (res.changes > 0) appendDealEvent(db, dealId, 'offline', { reason, before })
  return res.changes > 0
}

/** 撤销失效（恢复对外展示）；`expired` 类需同时延长有效期，由调用方先改 expires_at */
export function clearDealInvalid(db: Database.Database, dealId: string): boolean {
  const before = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId)
  const res = db.prepare(
    "UPDATE token_deals SET invalid_at = NULL, invalid_reason = '', updated_at = ? WHERE id = ? AND invalid_at IS NOT NULL"
  ).run(Date.now(), dealId)
  if (res.changes > 0) appendDealEvent(db, dealId, 'online', { reason: 'restored', before })
  return res.changes > 0
}

/**
 * 过期归档：把「已通过、未删除、未失效、有效期已过」的通告置为 invalid(expired)。
 *
 * 幂等 —— 已失效/已删除的行不会被重复改写；`invalid_at` 取到期时刻而非当前时刻，
 * 使后台「失效时间」列反映真实的到期时间。返回归档条数。
 */
export function archiveExpiredDeals(db: Database.Database, now = Date.now()): number {
  try {
    // 先取出行（事件需要「变更前」的样子），再批量归档
    const rows = db.prepare(`
      SELECT * FROM token_deals
      WHERE status = 'approved' AND deleted_at IS NULL AND invalid_at IS NULL
        AND expires_at IS NOT NULL AND expires_at <= ?
    `).all(now) as any[]
    const res = db.prepare(`
      UPDATE token_deals
      SET invalid_at = COALESCE(expires_at, ?), invalid_reason = 'expired'
      WHERE status = 'approved' AND deleted_at IS NULL AND invalid_at IS NULL
        AND expires_at IS NOT NULL AND expires_at <= ?
    `).run(now, now)
    for (const row of rows) {
      appendDealEvent(db, row.id, 'offline', { reason: 'expired', before: row })
    }
    return res.changes
  } catch (err: any) {
    console.warn('[token-deals] 过期归档失败（忽略）:', err?.message || err)
    return 0
  }
}

/**
 * 投票否决判定：真实投票落库后调用（**不要**放进 syncDealCounters，理由见上方注释）。
 *
 * 语义可逆：票可以改可以撤，故当负票回落到阈值以下时自动撤销 `votes` 类失效；
 * `manual` / `expired` 两类不被投票影响（人工判定与到期事实不该被投票覆盖）。
 */
export function evaluateDealVoteInvalidation(db: Database.Database, dealId: string): void {
  try {
    const row = db.prepare(
      'SELECT vote_up, vote_down, invalid_reason, invalid_at FROM token_deals WHERE id = ?'
    ).get(dealId) as { vote_up: number; vote_down: number; invalid_reason: string; invalid_at: number | null } | undefined
    if (!row) return

    const up = row.vote_up || 0
    const down = row.vote_down || 0
    const total = up + down
    const hit = down >= INVALID_VOTE_RULE.minDownVotes
      && total > 0
      && down / total >= INVALID_VOTE_RULE.minDownRatio

    const currentReason = row.invalid_at ? row.invalid_reason : ''
    if (hit && (!currentReason || currentReason === 'votes')) {
      if (!currentReason) markDealInvalid(db, dealId, 'votes')
    } else if (!hit && currentReason === 'votes') {
      clearDealInvalid(db, dealId)
    }
  } catch (err: any) {
    console.warn('[token-deals] 投票失效判定失败（忽略）:', err?.message || err)
  }
}

/**
 * 彻底删除（物理）：仅在管理员「彻底清除」时调用。
 * 明细表显式清理 —— 不依赖 FK 级联（CLI / 部分连接默认 foreign_keys=OFF，级联会静默失效）。
 */
export function purgeDealPermanently(db: Database.Database, dealId: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM token_deal_votes WHERE deal_id = ?').run(dealId)
    db.prepare('DELETE FROM token_deal_reviews WHERE deal_id = ?').run(dealId)
    db.prepare('DELETE FROM token_deal_edits WHERE deal_id = ?').run(dealId)
    db.prepare('DELETE FROM token_deal_guest_reviews WHERE deal_id = ?').run(dealId)
    // 评测打标：review_id 跨两张表故无 FK，必须显式清理，否则留下孤儿打标行
    db.prepare('DELETE FROM token_deal_review_marks WHERE deal_id = ?').run(dealId)
    // 游客投票：同样无 FK（游客没有 users 行），不显式清理即留下孤儿票
    db.prepare('DELETE FROM token_deal_guest_votes WHERE deal_id = ?').run(dealId)
    db.prepare('DELETE FROM token_deals WHERE id = ?').run(dealId)
    // 事件流是公开历史，通告本体消失后不得再留下指向它的条目
    deleteDealEvents(db, dealId)
  })()
}

/**
 * 读入口（详情 / 评测列表 / 游客评测 / 分享卡片）的可见性判定。
 *
 * 与详情端点同一口径，避免「详情已 404，但换个端点还能把内容读出来」：
 *   - 已删除：仅管理员（作者也不行 —— 恢复是管理员动作）；
 *   - 已失效 / 已过期：作者与管理员可见，其余一律不可见；
 *   - 公开可见：所有人。
 *
 * 注意 AI 通道的 `token.user_id` 与 Cookie 登录态都直接传进来即可，
 * 两边都只是「谁在看」，不涉及角色系统差异。
 */
export function canReadDeal(
  deal: Record<string, any>,
  viewer: { id?: number | null; isAdmin?: boolean } = {},
  now = Date.now(),
): boolean {
  if (!deal) return false
  if (deal.deleted_at) return !!viewer.isAdmin
  if (isPubliclyVisible(deal, now)) return true
  if (viewer.isAdmin) return true
  return viewer.id != null && deal.user_id === viewer.id
}

/**
 * 写入口（投票 / 评测 / 建议 / 打标 / 置顶 / 导入）的可见性闸门。
 *
 * 规则：
 *   - 通告不存在 或 已删除 → 一律 404（管理员也不给写，恢复走 restore 端点）；
 *   - 已失效 / 已过期 → 对普通访客 404（冻结交互，避免「已失效却继续收好评」的矛盾数据），
 *     管理员放行（要能在后台对失效条目做数据维护）。
 *
 * `allowVotesInvalid`（仅投票入口用）：因社区投票而失效的条目仍可继续投票 ——
 * 否则阈值一旦触发就自我锁定，负票再也撤不掉，「降到阈值以下自动恢复」这条可逆语义
 * 就永远走不到。人工判定（manual）与到期（expired）不放开，投票不该推翻这两类事实。
 */
export function findWritableDeal(
  db: Database.Database,
  dealId: string,
  opts: { isAdmin?: boolean; allowVotesInvalid?: boolean } = {},
): { ok: true; deal: Record<string, any> } | { ok: false; status: number; error: string } {
  const deal = db.prepare(
    'SELECT id, user_id, status, deleted_at, invalid_at, invalid_reason, expires_at FROM token_deals WHERE id = ?'
  ).get(dealId) as Record<string, any> | undefined

  if (!deal || deal.deleted_at) {
    return { ok: false, status: 404, error: '通告不存在' }
  }
  if (!opts.isAdmin && !isPubliclyVisible(deal)) {
    const votesOnly = opts.allowVotesInvalid
      && !!deal.invalid_at
      && deal.invalid_reason === 'votes'
      && !(deal.expires_at && deal.expires_at <= Date.now())
    if (!votesOnly) {
      return { ok: false, status: 404, error: '通告已失效或已过期，暂不可操作' }
    }
  }
  return { ok: true, deal }
}
