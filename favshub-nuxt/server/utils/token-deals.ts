/**
 * Token 白嫖通告 — 共享常量、输入校验与统计同步
 *
 * 品质分级（五档）与来源标签沿用「AI 资源导航」站点的体系；
 * 可用性投票与综合评分沿用「FreeBuddy 免费模型专区」的社区健康度模型。
 */
import type Database from 'better-sqlite3'
import { appendDealEvent, deleteDealEvents } from './deal-events'
import { getConfigInt } from './config'
import { getRawDb } from '../database'
import { notifyTokenDealApproved, notifyTokenDealRejected } from './qq-notify'

// ── 品级 / 地区 / 来源枚举 ──────────────────────────────────────────
// 真源在 `utils/deal-fields.ts`（2026-11-05 收敛）。这里「先 import 再 export」，
// **不能只写 `export { ... } from '...'`** —— 纯重导出不建立本地绑定，
// 而同文件下方还要用到它们（上轮 `DEAL_CATEGORIES` 就是这么炸的）。
// 保留本模块的导出面，是为了不动既有引用方（sitemap / deal-events / 各页面）。
import {
  QUALITY_LEVELS, REGIONS, REGION_LABELS, SOURCE_TAGS, SOURCE_LABELS,
} from '../../utils/deal-fields'
export type { QualityLevel } from '../../utils/deal-fields'
export { QUALITY_LEVELS, REGIONS, REGION_LABELS, SOURCE_TAGS, SOURCE_LABELS }

/**
 * 通告分类 — API 额度（默认）/ 免费云服务器 / 免费域名 / 客户端额度。
 *
 * 云服务器（VPS / PaaS / Serverless 免费档）、免费域名、客户端额度
 * （各类大模型客户端/桌面端专属免费额度）与「API 额度」共用一块通告板，
 * 用分类让读者一键筛掉不关心的那一半。
 *
 * **真源已收敛到 `utils/deal-categories.ts`**（2026-11-05）。
 * 这里只做重导出，保持既有引用面（`server/utils/*`、`deal-events.ts`、
 * sitemap 等）不变；新增分类**只改 `utils/deal-categories.ts` 一处**，
 * 不必再同步卡片 / 详情 / 编辑器 / 筛选栏 / 后台 / 导航卡 / sitemap ——
 * 那种「手抄 8 处」的做法造成过三次实伤（client 漏在导航卡与 sitemap、
 * domain 在后台显示成「API 额度」、卡片徽标缺 domain），详见真源文件顶部。
 *
 * **顺序即前端展示顺序**（`domain` 加在 `client` 之前）。
 * 迁移里 `category` 列的默认值恒为 `'token'`，新增分类**不需要**改默认值。
 */
import { DEAL_CATEGORIES, DEAL_CATEGORY_LABELS } from '../../utils/deal-categories'

// ⚠️ 必须「先 import 再 export」，不能只写 `export { ... } from '...'`：
// 后者是**纯重导出**，不会在本模块内建立本地绑定，而同文件下方的校验逻辑
// （`DEAL_CATEGORIES.includes(...)`）要用到它 —— 只写重导出会运行时报
// 「DEAL_CATEGORIES is not defined」（2026-11-05 就是这么被 e2e 套件抓住的）。
export { DEAL_CATEGORIES, DEAL_CATEGORY_LABELS }

/** 通告状态 — 发布后进入 pending，管理员审核通过才公开 */
export const DEAL_STATUS = ['pending', 'approved', 'rejected'] as const

/**
 * 是否实名（2026-10-30，原话「否、身份证、人脸、其他（手动添加）」）。
 *
 * 与其它枚举不同，本字段**允许空串** = 未填 —— 存量通告迁移后就是这个值，
 * 前端据此**不渲染徽标**（否则 80 条老数据会一起冒出「需实名」）。
 * 取值非法（如 'passport'）一律 400，不静默降级成未填。
 */
export const REAL_NAME_VALUES = ['no', 'id_card', 'face', 'other'] as const
export type RealNameValue = (typeof REAL_NAME_VALUES)[number]

/** 徽标文案（前端可自行覆盖，这里给一份默认口径，供文档/后台复用） */
export const REAL_NAME_LABELS: Record<string, string> = {
  no: '无需实名',
  id_card: '需身份证',
  face: '需人脸',
  other: '需实名',
}

/** 字段长度上限 */
export const LIMITS = {
  provider: 60,
  title: 120,
  url: 500,
  callUrl: 500,
  quota: 200,
  /**
   * 备注：2026-10-30 由 500 提到 2000，并支持 Markdown / HTML / 图片富文本。
   * 富文本在服务端用白名单消毒（见 `server/utils/rich-text.ts`），前后端同时校验此上限。
   */
  note: 2000,
  /** 是否实名 → 「其他」的手填文案长度上限（如「需上传护照」「需银行卡验证」） */
  realNameOther: 40,
  models: 20,
  modelName: 60,
  reviewContent: 1000,
  /** 登录用户评测限频（每用户每小时）—— 补的是「批量注册 → 灌评测」这条路 */
  reviewPerUserPerHour: 20,
  /** 登录用户评测限频（每 IP 每小时）—— 多账号同源刷量兜底 */
  reviewPerIpPerHour: 40,
  // ── 2026-11-04 对齐 baipiao.org 详情页 IA 的结构化字段 ──
  // 这些字段与 `note` 同级，都是**普通用户可写**，所以富文本一律走服务端
  // `renderRichText()` 渲染（详见「富文本备注与 HTML 消毒」）。
  /** 一句话摘要 TL;DR（列表卡片与详情页标题下方各用一次） */
  summary: 200,
  /** 限制条款（文本量最大，同 note 上限） */
  limits: 2000,
  /** 领取条件（实名 / 绑卡 / GitHub 登录 / PR / 邀请码等） */
  requirements: 2000,
  /** 核实范围说明（站点到底核了什么：注册 / 到账 / 调用） */
  verifyScope: 500,
  /** FAQ 条数上限 */
  faq: 10,
  /** FAQ 单条问题长度上限 */
  faqQ: 100,
  /** FAQ 单条答案长度上限 */
  faqA: 600,
} as const

/**
 * FAQ 存库形态：JSON 数组字符串。
 *
 * 抽成常量是为了**迁移 DDL 与代码不漂移** —— `migrate.ts` 的
 * `ALTER TABLE ... DEFAULT '[]'` 与「解析失败回落成的空数组」必须是同一份写法。
 */
export const DEFAULT_FAQ_JSON = '[]'

/** FAQ 单条 */
export interface FaqItem {
  q: string
  a: string
}

/** 归一化一条 FAQ 的字段（trim + 截断），供解析与校验两路复用，避免规则分叉 */
function normalizeFaqItem(raw: any): FaqItem {
  return {
    q: String(raw?.q ?? '').trim().slice(0, LIMITS.faqQ),
    a: String(raw?.a ?? '').trim().slice(0, LIMITS.faqA),
  }
}

/**
 * 解析库中的 `faq` 字段（JSON 数组字符串）→ `{q,a}[]`。
 *
 * **只用于读 / 展示**，任何异常（非字符串、非法 JSON、不是数组）一律回 `[]`；
 * 逐条丢弃结构不合法（缺 q 或 a）的项，并在超上限时截断到 `LIMITS.faq` 条。
 * 不抛异常 —— 一条脏数据不该让整个详情页 500。
 */
export function parseFaq(raw: unknown): FaqItem[] {
  if (Array.isArray(raw)) return raw.map(normalizeFaqItem).filter(it => it.q && it.a).slice(0, LIMITS.faq)
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeFaqItem)
      .filter(it => it.q && it.a)
      .slice(0, LIMITS.faq)
  } catch {
    return []
  }
}

/**
 * 把关（写入口用）：`{q,a}[]` 或 `{ error }`。**严格**，与 `parseFaq` 的宽松解析刻意不同 ——
 * 读取侧要容忍历史脏数据，写入侧不能悄悄吞掉用户输入。
 *
 * 拒绝条件：非数组（JSON 字符串会先解析一次）、超 `LIMITS.faq` 条、某条缺 q 或 a、q / a 超长。
 * 返回的数组已 trim（与 `readDealField` 的「显式出现才算」语义配合：
 * 传 `[]` = 清空 FAQ，不传 = 保持原值）。
 *
 * ⚠️ 解析与校验**必须分成两步**（`decodeFaqInput` 只做 JSON 解码、`checkFaqList` 只做校验）：
 * 早先写成「字符串就递归调自己」，会让合法 JSON 字符串无限递归直到栈溢出。
 */
export function normalizeFaq(input: unknown): FaqItem[] | { error: string } {
  const decoded = decodeFaqInput(input)
  if (!decoded.ok) return { error: decoded.error }
  return checkFaqList(decoded.value)
}

/** 只做「JSON 字符串 → 数组」的解码；空值视为空数组（= 清空 FAQ） */
function decodeFaqInput(input: unknown): { ok: true; value: unknown[] } | { ok: false; error: string } {
  if (input === undefined || input === null || input === '') return { ok: true, value: [] }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (!Array.isArray(parsed)) return { ok: false, error: 'FAQ 必须是数组' }
      return { ok: true, value: parsed }
    } catch {
      return { ok: false, error: 'FAQ 不是合法的 JSON' }
    }
  }
  if (!Array.isArray(input)) return { ok: false, error: 'FAQ 必须是数组' }
  return { ok: true, value: input }
}

/** 只做逐条校验（严格）+ trim */
function checkFaqList(list: unknown[]): FaqItem[] | { error: string } {
  if (list.length > LIMITS.faq) return { error: `FAQ 最多 ${LIMITS.faq} 条` }
  const out: FaqItem[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') return { error: 'FAQ 每项必须包含「问题」与「答案」' }
    const q = String((raw as any).q ?? '').trim()
    const a = String((raw as any).a ?? '').trim()
    if (!q || !a) return { error: 'FAQ 每项必须同时填写「问题」与「答案」' }
    if (q.length > LIMITS.faqQ) return { error: `FAQ 问题不能超过 ${LIMITS.faqQ} 字` }
    if (a.length > LIMITS.faqA) return { error: `FAQ 答案不能超过 ${LIMITS.faqA} 字` }
    out.push({ q, a })
  }
  return out
}

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
  category: string
  expiresAt: number | null
  note: string
  /** 是否实名：''=未填 | no | id_card | face | other */
  realName: string
  /** 「其他」的手填文案；real_name !== 'other' 时恒为空串 */
  realNameOther: string
  // ── 2026-11-04 结构化字段（对齐 baipiao.org 详情页 IA）──
  /** 一句话摘要 TL;DR */
  summary: string
  /** 限制条款 */
  limits: string
  /** 领取条件 */
  requirements: string
  /** 核实范围说明 */
  verifyScope: string
  /** FAQ（已校验的数组；落库时序列化为 JSON 字符串） */
  faq: FaqItem[]
}

/**
 * 归一化「是否实名」两列 —— **三条写路径共用的唯一实现**。
 *
 * 三条写路径（Web `POST` / `PUT`、修改建议审核、AI patch）落库前**都必须**经
 * `validateDealPayload()`，所以规则写在这里即对三者一致生效。
 * 端点上不要再写一遍 `if (realName !== 'other') ...` —— 校验与清空规则只许有一处，
 * 否则迟早出现「直接编辑会清空、走建议通道却留下脏文案」这类旁路（本仓吃过同类亏）。
 *
 * 规则：
 *   1. `real_name_other` 只在 `real_name === 'other'` 时有意义，其余情况**强制清空**；
 *   2. 枚举合法性由 `validateDealPayload` 判定（非法值返回 400，不在这里静默降级）。
 */
export function normalizeRealName(
  rawName: unknown,
  rawOther: unknown,
): { realName: string; realNameOther: string } {
  const realName = String(rawName ?? '').trim()
  // 截断是纵深防御：长度上限由 validateDealPayload 显式拒绝，这里保证任何调用方都拿不到超长值
  const other = String(rawOther ?? '').trim().slice(0, LIMITS.realNameOther)
  return { realName, realNameOther: realName === 'other' ? other : '' }
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

  const category = String(body?.category ?? 'token')
  if (!DEAL_CATEGORIES.includes(category as any)) return { ok: false, error: '通告分类取值非法' }

  // 是否实名：空串 = 未填（允许），其余必须是枚举值 —— 非法值显式拒绝，不静默降级
  const realNameRaw = String(body?.real_name ?? body?.realName ?? '').trim()
  if (realNameRaw && !REAL_NAME_VALUES.includes(realNameRaw as any)) {
    return { ok: false, error: '是否实名取值非法（可选：否 / 身份证 / 人脸 / 其他，留空表示未填）' }
  }
  const realNameOtherRaw = String(body?.real_name_other ?? body?.realNameOther ?? '').trim()
  if (realNameOtherRaw.length > LIMITS.realNameOther) {
    return { ok: false, error: `实名方式说明不能超过 ${LIMITS.realNameOther} 字` }
  }
  const { realName, realNameOther } = normalizeRealName(realNameRaw, realNameOtherRaw)

  // ── 2026-11-04 结构化字段：全部普通用户可写，超长一律 400（不静默截断）──
  const summary = String(body?.summary ?? '').trim()
  if (summary.length > LIMITS.summary) return { ok: false, error: `一句话摘要不能超过 ${LIMITS.summary} 字` }

  const limits = String(body?.limits ?? '').trim()
  if (limits.length > LIMITS.limits) return { ok: false, error: `限制条款不能超过 ${LIMITS.limits} 字` }

  const requirements = String(body?.requirements ?? '').trim()
  if (requirements.length > LIMITS.requirements) {
    return { ok: false, error: `领取条件不能超过 ${LIMITS.requirements} 字` }
  }

  // 兼容 snake_case（DB / Web 表单）与 camelCase（部分调用方）
  const verifyScope = String(body?.verify_scope ?? body?.verifyScope ?? '').trim()
  if (verifyScope.length > LIMITS.verifyScope) {
    return { ok: false, error: `核实范围不能超过 ${LIMITS.verifyScope} 字` }
  }

  // FAQ：严格校验（非数组 / 超条数 / 缺字段 / 超长 → 400），错误文案透传给调用方
  const faqResult = normalizeFaq(body?.faq)
  if (!Array.isArray(faqResult)) return { ok: false, error: faqResult.error }

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
      category,
      expiresAt,
      note,
      realName,
      realNameOther,
      summary,
      limits,
      requirements,
      verifyScope,
      faq: faqResult,
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

/**
 * 提案可修改的字段白名单（不含 status / pinned / user_id / 计数列 —— 由权限与站点规则决定）。
 *
 * 这份白名单是**三处共用**的单一真源：修改建议通道（`extractDealPatch`）、
 * AI patch 通道（`ai-service.ts` 的 `DEAL_UPDATABLE`）、以及各端点的字段标签。
 * 新增可改字段时只改这里 + 三处落库 UPDATE 的列清单（少改一处会「校验通过但没写库」）。
 */
export const DEAL_PATCHABLE = [
  'provider', 'title', 'url', 'call_url', 'quota', 'models',
  'region', 'quality', 'source_tag', 'category', 'expires_at', 'note',
  // 是否实名（2026-10-30）：与其余内容字段同级，可走建议通道与 AI patch。
  // 枚举校验与「real_name_other 清空规则」收口在 `validateDealPayload`/`normalizeRealName`，
  // 三条写路径共用，不存在「直接编辑被拒、走建议通道却写进去」的旁路。
  'real_name', 'real_name_other',
  // 结构化字段（2026-11-04）：与 note 同级，都是普通用户可写的**内容**字段，
  // 故同样可走建议通道与 AI patch。
  // ⚠️ 刻意**不含** `featured`（仅管理员可写，与 pinned 同口径）与 `source_url`
  //    （运营字段，只由导入脚本直连 DB 写）。
  'summary', 'limits', 'requirements', 'verify_scope', 'faq',
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
  category: '分类',
  expires_at: '有效期',
  note: '备注',
  real_name: '是否实名',
  real_name_other: '实名方式说明',
  summary: '一句话摘要',
  limits: '限制条款',
  requirements: '领取条件',
  verify_scope: '核实范围',
  faq: '常见问题',
}

/** snake_case → camelCase 别名（请求体两种写法都接受） */
const DEAL_FIELD_ALIASES: Record<string, string> = {
  call_url: 'callUrl',
  source_tag: 'sourceTag',
  expires_at: 'expiresAt',
  real_name: 'realName',
  real_name_other: 'realNameOther',
  verify_scope: 'verifyScope',
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
    category: deal?.category,
    expires_at: deal?.expires_at ?? null,
    note: deal?.note,
    // 未填（空串）是合法值，故用 `?? ''` 兜住「旧库列尚未迁移」的 undefined
    real_name: deal?.real_name ?? '',
    real_name_other: deal?.real_name_other ?? '',
    // 结构化字段（2026-11-04）：同样用 `?? ''` / `parseFaq` 兜住旧库未迁移的 undefined。
    // `faq` 必须解成**数组**再参与比较 —— 库里的 JSON 字符串与请求体的数组
    // 若直接 `JSON.stringify` 比对会永远不相等，导致每条通告误报一次 `faq` 变更。
    summary: deal?.summary ?? '',
    limits: deal?.limits ?? '',
    requirements: deal?.requirements ?? '',
    verify_scope: deal?.verify_scope ?? '',
    faq: parseFaq(deal?.faq),
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

/**
 * 把校验后的 DealPayload 收敛回 snake_case patch（只保留 keys 指定的字段）。
 *
 * `full` **必须覆盖 `DEAL_PATCHABLE` 的每一个键**：`diffDealPatch` 是按 keys 逐个比值的，
 * 漏掉某键会让 `out[key]` 变成 `undefined`，被当成「改成空」而**每条通告都会误报一次该字段变更**
 * （进而发出一条假的 `updated` 事件）。`category` 此前正是这么漏的，已一并补齐。
 */
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
    category: d.category,
    expires_at: d.expiresAt,
    note: d.note,
    real_name: d.realName,
    real_name_other: d.realNameOther,
    summary: d.summary,
    limits: d.limits,
    requirements: d.requirements,
    verify_scope: d.verifyScope,
    faq: d.faq,
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
  // ⚠️ 2026-11-04 语义变更：审核通过 → state='verified'（已审核），**不是** published。
  //
  // 「已审核」是可信度标记，「已发布」才是前端展示。审过的人还要自己决定是否上线
  // （例如导入渠道要先替换掉指向他站的链接）。把这两档分开，是为了避免
  // 「一点通过就对外可见」——那正是之前那 10 条域名被误上线的成因。
  //
  // 例外：如果它**本来就是 published**（重审一个已发布的条目），保持 published 不变，
  // 否则重审反而会把线上条目踢下线。
  const nextState = action === 'approve'
    ? (deal.state === 'published' ? 'published' : 'verified')
    : 'rejected'
  const finalReason = action === 'reject' ? String(reason ?? '').trim().slice(0, 200) : ''
  db.prepare(
    'UPDATE token_deals SET state = ?, status = ?, reject_reason = ?, updated_at = ? WHERE id = ?'
  ).run(nextState, status, finalReason, Date.now(), dealId)

  // 只有真正转入 published 才算对外「上新」；仅在 verified 不发上线事件，
  // 否则订阅者会收到一条点开却 404 的推送。
  if (action === 'approve' && nextState === 'published') {
    appendDealEvent(db, dealId, 'online', { before: deal })
  }

  try {
    if (action === 'approve') {
      notifyTokenDealApproved(deal, deal.user_id)
    } else {
      notifyTokenDealRejected(deal, deal.user_id, finalReason)
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

// ════════════════════════════════════════════════════════════════
// 统一状态机（2026-11-04）
//
// 原先状态散在 4 个字段里，前端/后台/API 各自组合判断，极易漏判：
//   status(pending|approved|rejected) + deleted_at + invalid_at + expires_at
// 现在收敛成单一 `state` 列，一个字段说清「这条通告现在是什么」。
//
// **「已审核」与「已发布」是两个态，且有优先级**：
//   - 已发布(published) = 前端展示的**唯一**驱动条件
//   - 已审核(verified)  = 可信度标记，**不**决定是否展示，优先级低于已发布
// 所以「审过了但还没上」是 verified 而不是 published —— 这正是
// 「导入渠道先不展示、等替换完链接再手动发布」所需要的那一档。
// ════════════════════════════════════════════════════════════════

export const DEAL_STATES = ['pending', 'verified', 'published', 'offline', 'invalid', 'rejected', 'deleted'] as const
export type DealState = (typeof DEAL_STATES)[number]

/** 状态中文标签（后台 tab / 前端编辑器共用，勿各写一份） */
export const DEAL_STATE_LABELS: Record<DealState, string> = {
  pending: '待审核',
  verified: '已审核',
  published: '已发布',
  offline: '已下架',
  invalid: '已失效',
  rejected: '已驳回',
  deleted: '已删除',
}

/** 状态的展示分组：哪些对公众可见（只此一档） */
export const PUBLIC_VISIBLE_STATES: readonly DealState[] = ['published'] as const
/** 后台审核队列：还需要人处理 / 待发布 */
export const REVIEW_QUEUE_STATES: readonly DealState[] = ['pending', 'verified'] as const
/** 终态：不再出现在任何队列，需要显式恢复 */
export const TERMINAL_STATES: readonly DealState[] = ['offline', 'invalid', 'deleted', 'rejected'] as const

/**
 * 旧四字段 → 新 state 的映射（迁移与兼容读共用）。
 *
 * 判定顺序即优先级，**必须**按这个顺序，否则「已删除的已发布条目」会被算成 published：
 *   deleted_at → invalid_at → status(rejected/pending) → expires_at → approved=published
 */
export function legacyStateOf(row: {
  status?: string | null
  deleted_at?: number | null
  invalid_at?: number | null
  expires_at?: number | null
}, now = Date.now()): DealState {
  if (row.deleted_at) return 'deleted'
  if (row.invalid_at) return 'invalid'
  if (row.status === 'rejected') return 'rejected'
  if (row.status === 'pending') return 'pending'
  if (row.expires_at && row.expires_at <= now) return 'invalid'
  return 'published'
}

/** state 是否对公众可见（过期判定仍按 expires_at 运行时算一次，不依赖归档任务） */
export function isStatePubliclyVisible(
  state: string | null | undefined,
  expires_at: number | null | undefined,
  now = Date.now(),
): boolean {
  if (!state || !(PUBLIC_VISIBLE_STATES as readonly string[]).includes(state)) return false
  if (expires_at && expires_at <= now) return false
  return true
}

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
  // 2026-11-04 收敛：原先要同时满足「approved + 未删除 + 未失效 + 未过期」，
  // 四个条件散在每个调用方各写一遍，漏一个就泄露。现在只看单列 state。
  // 过期仍运行时判一次（不依赖归档任务跑没跑）。
  params.push('published', now)
  return ` AND ${alias}.state = ? AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)`
}

/** 单条通告是否对外可见（内存判断，供端点对已查出的行做二次校验） */
export function isPubliclyVisible(
  deal: { state?: string | null; expires_at?: number | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!deal) return false
  return isStatePubliclyVisible(deal.state, deal.expires_at, now)
}

/** 软删除：置 deleted_at，明细表（投票/评测/建议/打标）全部保留，可恢复 */
export function softDeleteDeal(db: Database.Database, dealId: string, actorId: number): boolean {
  const before = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId)
  const res = db.prepare(
    // state 是新真相源，deleted_at 保留双写（旧列当备份，回滚时数据仍在）
    "UPDATE token_deals SET state = 'deleted', deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
  ).run(Date.now(), actorId, Date.now(), dealId)
  if (res.changes > 0) appendDealEvent(db, dealId, 'offline', { reason: 'deleted', before })
  return res.changes > 0
}

/** 恢复软删除 */
export function restoreDeletedDeal(db: Database.Database, dealId: string): boolean {
  const before = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId)
  // 恢复不是简单回 published：删除前它可能本来就是 invalid / verified。
  // 按旧列反推（旧列仍在双写，所以可靠），再回填 state。
  const prev = before as any
  const nextState = legacyStateOf({
    status: prev?.status,
    deleted_at: null,                    // 已清除
    invalid_at: prev?.invalid_at ?? null,
    expires_at: prev?.expires_at ?? null,
  })
  const res = db.prepare(
    'UPDATE token_deals SET state = ?, deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL'
  ).run(nextState, Date.now(), dealId)
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
    "UPDATE token_deals SET state = 'invalid', invalid_at = ?, invalid_reason = ?, updated_at = ? WHERE id = ? AND invalid_at IS NULL"
  ).run(at, reason, Date.now(), dealId)
  if (res.changes > 0) appendDealEvent(db, dealId, 'offline', { reason, before })
  return res.changes > 0
}

/** 撤销失效（恢复对外展示）；`expired` 类需同时延长有效期，由调用方先改 expires_at */
export function clearDealInvalid(db: Database.Database, dealId: string): boolean {
  const before = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId)
  // 撤销失效后回到哪一档，取决于它「有没有被审核过」：
  // 审核通过过的 → published；从未发布、只是待审核 → 回到 verified/pending。
  // 这里以 status 旧列 + verified_at 联合判断，避免把一条从未发布的草稿直接放上线。
  const prev = before as any
  const everPublished = prev?.status === 'approved'
  const nextState = everPublished ? 'published' : (prev?.status === 'pending' ? 'pending' : 'verified')
  const res = db.prepare(
    "UPDATE token_deals SET state = ?, invalid_at = NULL, invalid_reason = '', updated_at = ? WHERE id = ? AND invalid_at IS NOT NULL"
  ).run(nextState, Date.now(), dealId)
  if (res.changes > 0) appendDealEvent(db, dealId, 'online', { reason: 'restored', before })
  return res.changes > 0
}

// ════════════════════════════════════════════════════════════════
// 人工核验（可信度时间轴，2026-10-20）
//
// 白嫖资源最大的坑是「早失效了还挂在列表里」。社区投票是**用户**反馈，
// 人工核验是**站点确认「此时此刻仍然可用」**，两者互补：
//
//   - `token_deals.verified_at`  最近一次确认可用的时刻（0 / NULL = 从未核验）
//   - `token_deals.verified_by`  核验人（管理员用户名，对外不下发）
//   - `token_deals.verify_note`  最近一次核验备注（如「注册实测通过，额度到账」）
//   - `token_deal_verifications` 核验历史（谁 / 何时 / 结论 / 备注），append-only
//
// 「待复核」= 超过 `deal_verify_stale_days`（默认 30 天）没核验 —— 只在前台**提示**，
// 不改可见性（「看起来该复核」与「真的失效」必须分开，可见性仍由
// status / deleted_at / invalid_at / expires_at 决定）。
//
// **核验本身不产生事件**：确认「没有变化」不该推给订阅者。只有核验判定失效
// （action='dead' → markDealInvalid('manual')）才走既有的 offline 事件，订阅者才知道下架。
// ════════════════════════════════════════════════════════════════

/** 核验动作：可用 / 失效 / 仅追加备注 */
export const VERIFY_ACTIONS = ['alive', 'dead', 'note'] as const
export type VerifyAction = (typeof VERIFY_ACTIONS)[number]

/** 核验动作中文标签 */
export const VERIFY_ACTION_LABELS: Record<string, string> = {
  alive: '核验可用',
  dead: '核验失效',
  note: '补充说明',
}

/** 待复核阈值（天）：可用 `deal_verify_stale_days` 覆盖，范围 7–365 */
export function verifyStaleDays(): number {
  try {
    const n = getConfigInt('deal_verify_stale_days', 30)
    return n >= 7 && n <= 365 ? n : 30
  } catch {
    return 30
  }
}

/** 是否待复核（从未核验也算） */
export function isVerifyStale(
  deal: { verified_at?: number | null } | null | undefined,
  now = Date.now(),
): boolean {
  const at = Number(deal?.verified_at || 0)
  return !at || now - at > verifyStaleDays() * 86400000
}

/** 距上次核验的天数；从未核验返回 -1 */
export function verifyAgeDays(
  deal: { verified_at?: number | null } | null | undefined,
  now = Date.now(),
): number {
  const at = Number(deal?.verified_at || 0)
  if (!at) return -1
  return Math.max(0, Math.floor((now - at) / 86400000))
}

/** 核验历史（默认最近 10 条，供详情页展示） */
export function loadVerifications(
  db: Database.Database,
  dealId: string,
  limit = 10,
): Array<{ action: string; action_label: string; note: string; actor: string; created_at: number }> {
  try {
    const rows = db.prepare(
      'SELECT action, note, actor, created_at FROM token_deal_verifications'
      + ' WHERE deal_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    ).all(dealId, Math.max(1, Math.min(50, limit))) as any[]
    return rows.map(r => ({
      action: String(r.action || ''),
      action_label: VERIFY_ACTION_LABELS[r.action] || '核验',
      note: String(r.note || ''),
      actor: String(r.actor || ''),
      created_at: Number(r.created_at || 0),
    }))
  } catch {
    return []
  }
}

export interface VerifyResult {
  ok: boolean
  action: VerifyAction
  /** 核验后该通告是否对外可见（不可见时前端要提示「先撤销失效 / 续期」） */
  visible: boolean
  /** 本次核验是否**新**把通告置为失效（true 才会新增 offline 事件） */
  invalidated: boolean
  verified_at: number
  message: string
}

/**
 * 执行一次人工核验。
 *
 * - `alive`：记录「此刻仍可用」。**不**顺手撤销失效 / 续期 —— 状态变更走既有
 *   restore 端点（管理员看得见自己点了什么，比隐式恢复安全）。通告当前不可见时
 *   依旧记录，但 message 里说清楚该先做什么。
 * - `dead`：判定失效（reason=manual，幂等；已失效则不再重复发事件）。
 * - `note`：只追加一条备注，不改 `verified_at`（备注 ≠ 核验）。
 */
export function verifyDeal(
  db: Database.Database,
  dealId: string,
  opts: { action: VerifyAction; note?: string; actor?: string },
): VerifyResult {
  const now = Date.now()
  const action = (VERIFY_ACTIONS as readonly string[]).includes(opts.action) ? opts.action : 'alive'
  const note = String(opts.note || '').trim().slice(0, 300)
  const actor = String(opts.actor || '').trim().slice(0, 60)
  const base: VerifyResult = {
    ok: false,
    action: action as VerifyAction,
    visible: false,
    invalidated: false,
    verified_at: 0,
    message: '',
  }

  const row = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId) as any
  if (!row) return { ...base, message: '通告不存在' }
  if (row.deleted_at) return { ...base, message: '通告已删除，不能核验（请先恢复）' }

  let invalidated = false
  // 失效判定（含 offline 事件）与核验时间写入放在同一事务里，
  // 避免「事件已发、核验时间却没落库」的半状态
  const applyWrite = db.transaction(() => {
    if (action === 'dead') {
      invalidated = markDealInvalid(db, dealId, 'manual', now)
    }
    if (action === 'alive' || action === 'dead') {
      const keepNote = note || (action === 'dead' ? '核验发现已失效' : String(row.verify_note || ''))
      db.prepare(
        'UPDATE token_deals SET verified_at = ?, verified_by = ?, verify_note = ?, updated_at = ? WHERE id = ?',
      ).run(now, actor, keepNote, now, dealId)
    }
  })
  applyWrite()

  try {
    db.prepare(
      'INSERT INTO token_deal_verifications (deal_id, action, note, actor, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(dealId, action, note, actor, now)
  } catch (err: any) {
    // 历史表写失败不该让核验本身失败（verified_at 已落库）
    console.warn('[token-deals] 写核验历史失败（忽略）:', err?.message || err)
  }

  const fresh = db.prepare(
    'SELECT deleted_at, invalid_at, expires_at, verified_at FROM token_deals WHERE id = ?',
  ).get(dealId) as any
  const visible = isPubliclyVisible(fresh, now)

  let message: string
  if (action === 'note') {
    message = '已追加核验备注'
  } else if (action === 'dead') {
    message = invalidated
      ? '已标记失效（订阅者会收到「下架」）'
      : '已记录核验结论（该通告此前已失效）'
  } else if (visible) {
    message = '已记录核验：仍可用'
  } else {
    message = '核验记录已保存，但该通告当前对外不可见（已失效 / 已过期）；如确认仍可用，请先「撤销失效」或「续期」'
  }

  return {
    ok: true,
    action: action as VerifyAction,
    visible,
    invalidated,
    verified_at: action === 'note' ? Number(fresh?.verified_at || 0) : now,
    message,
  }
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
      WHERE state = 'published' AND expires_at IS NOT NULL AND expires_at <= ?
    `).all(now) as any[]
    const res = db.prepare(`
      UPDATE token_deals
      SET state = 'invalid', invalid_at = COALESCE(expires_at, ?), invalid_reason = 'expired'
      WHERE state = 'published' AND expires_at IS NOT NULL AND expires_at <= ?
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
 * 投票否决判定（已停用）：
 * 2026-10-30 需求变更：取消社区判定失效下架功能，投票仅作为可用性参考指标，
 * 下架只能由管理员在后台手动操作（manual 失效或软删除）。保留函数保持兼容。
 */
export function evaluateDealVoteInvalidation(_db: Database.Database, _dealId: string): void {
  // 已取消社区投票自动下架逻辑，空实现保持签名兼容
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
    // 邀请码池（2026-10-30）：表上带了 ON DELETE CASCADE，但如上所述不能依赖级联
    db.prepare('DELETE FROM token_deal_invite_codes WHERE deal_id = ?').run(dealId)
    db.prepare('DELETE FROM token_deals WHERE id = ?').run(dealId)
    // 事件流是公开历史，通告本体消失后不得再留下指向它的条目
    deleteDealEvents(db, dealId)
  })()
}

/**
 * 读入口（详情 / 评测列表 / 游客评测 / 分享卡片 / 邀请码）的可见性判定。
 *
 * 与详情端点同一口径，避免「详情已 404，但换个端点还能把内容读出来」：
 *   - 已删除：仅管理员（作者也不行 —— 恢复是管理员动作）；
 *   - **未过审（`pending` / `rejected`）：仅作者与管理员**；
 *   - 已失效 / 已过期：作者与管理员可见，其余一律不可见；
 *   - 公开可见：所有人。
 *
 * `status='approved'` 为什么必须判在**这里**（2026-10-30 审查修）：
 * 本函数原先只判 deleted/invalid/expired，注释写「与 `status='approved'` 配合」，
 * 等于把补 status 的责任推给每个调用方 —— 详情端点自己补了，新加的邀请码端点没补，
 * 于是未过审 / 已驳回通告的邀请码可被匿名读到（实测 200 + 明文码，而同一 deal 的详情是 403）。
 * 可见性口径要收在函数内部：**新增任何按 id 读通告内容的端点，直接调它就行**。
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
  if (deal.state === 'deleted') return !!viewer.isAdmin
  // 已发布 + 未过期 → 谁都能看（这是唯一的公开档）
  if (isPubliclyVisible(deal, now)) return true
  if (viewer.isAdmin) return true
  return viewer.id != null && deal.user_id === viewer.id
}

/**
 * 写入口（投票 / 评测 / 建议 / 打标 / 置顶 / 导入 / 邀请码计数）的可见性闸门。
 *
 * 规则：
 *   - 通告不存在 或 已删除 → 一律 404（管理员也不给写，恢复走 restore 端点）；
 *   - **未过审（`pending` / `rejected`）→ 对非管理员 404**，且不透露审核状态
 *     （2026-10-30 审查修：原先漏判 `status`，未过审通告的写入口对匿名访客是放行的）；
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
    'SELECT id, user_id, state, invalid_reason, expires_at FROM token_deals WHERE id = ?'
  ).get(dealId) as Record<string, any> | undefined

  if (!deal || deal.state === 'deleted') {
    return { ok: false, status: 404, error: '通告不存在' }
  }
  // 未发布视同「不存在」：不向调用方暴露审核状态
  // （verified 也不放行 —— 审过了但没发布，对外就是不存在）
  if (!isStatePubliclyVisible(deal.state, deal.expires_at) && !opts.isAdmin) {
    return { ok: false, status: 404, error: '通告不存在' }
  }
  if (!opts.isAdmin && !isPubliclyVisible(deal)) {
    const votesOnly = opts.allowVotesInvalid
      && deal.state === 'invalid'
      && deal.invalid_reason === 'votes'
      && !(deal.expires_at && deal.expires_at <= Date.now())
    if (!votesOnly) {
      return { ok: false, status: 404, error: '通告已失效或已过期，暂不可操作' }
    }
  }
  return { ok: true, deal }
}

// ════════════════════════════════════════════════════════════════
// 统一状态写入（2026-11-04）
//
// 一个入口处理所有「把这条通告改成某个状态」的请求，无论来自后台下拉、
// 前端编辑器还是 API。好处是：双写旧列、发事件、校验合法性的规则只有一份。
// ════════════════════════════════════════════════════════════════

/** 允许通过此入口设置的状态（deleted 走软删除端点，避免绕过可恢复语义） */
export const SETTABLE_STATES = ['pending', 'verified', 'published', 'offline', 'invalid', 'rejected'] as const

export interface SetStateResult {
  ok: boolean
  status?: number
  error?: string
  from?: DealState
  to?: DealState
  /** 是否有实际变化（false = 本来就是这个状态） */
  changed?: boolean
}

/**
 * 设置通告状态。会**双写**旧四列（`status` / `deleted_at` / `invalid_at`），
 * 使回滚到旧代码后数据仍自洽。
 *
 * 关键联动：
 *   - → published：清掉 invalid/deleted 痕迹（否则线上又不显示，自相矛盾）
 *   - → invalid：写 invalid_at + invalid_reason
 *   - → offline：仅置 state，不动 expire（下架是主动行为，不是过期）
 *   - → pending / verified：清掉失效痕迹
 */
export function setDealState(
  db: Database.Database,
  dealId: string,
  next: DealState,
  opts: { actorId?: number; invalidReason?: InvalidReason; now?: number } = {},
): SetStateResult {
  const now = opts.now ?? Date.now()
  const before = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId) as any
  if (!before) return { ok: false, status: 404, error: '通告不存在' }

  const from = (before.state ?? legacyStateOf(before, now)) as DealState
  if (from === next) return { ok: true, from, to: next, changed: false }

  // 旧的 status 列值：published/verified → approved；其余按语义映射
  const legacyStatus = next === 'published' || next === 'verified'
    ? 'approved'
    : (next === 'rejected' ? 'rejected' : (next === 'pending' ? 'pending' : (before.status || 'approved')))

  const sets: string[] = ['state = ?', 'status = ?', 'updated_at = ?']
  const vals: any[] = [next, legacyStatus, now]

  // 失效痕迹：只有 invalid 态该有
  if (next === 'invalid') {
    const reason: InvalidReason = opts.invalidReason ?? (before.invalid_reason || 'manual')
    sets.push('invalid_at = COALESCE(invalid_at, ?)', 'invalid_reason = ?')
    vals.push(now, reason)
  } else {
    sets.push("invalid_at = NULL", "invalid_reason = ''")
  }

  // 删除痕迹：此入口不处理删除，但要保证「从 deleted 恢复」时清干净
  if (before.deleted_at && next !== 'deleted') {
    sets.push('deleted_at = NULL', 'deleted_by = NULL')
  }

  vals.push(dealId)
  db.prepare(`UPDATE token_deals SET ${sets.join(', ')} WHERE id = ?`).run(...vals)

  // 事件流：进/出公开可见都要发，否则订阅者看到的和站点不一致
  const wasPublic = from === 'published'
  const nowPublic = next === 'published'
  if (!wasPublic && nowPublic) {
    appendDealEvent(db, dealId, 'online', { before })
  } else if (wasPublic && !nowPublic) {
    appendDealEvent(db, dealId, 'offline', { reason: next === 'invalid' ? 'invalid' : 'offline', before })
  }

  return { ok: true, from, to: next, changed: true }
}
