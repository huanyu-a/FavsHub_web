/**
 * Token 白嫖通告 — 评测「有用」打标服务层
 *
 * ## 定位
 *
 * 「社区健康度」原有两维：可用性投票（还能用/已失效）与星级评分。
 * 二者衡量的都是**通告本身**；本模块补上第三维 ——
 * 衡量**别人的评测值不值得看**，让高质量评测浮上来。
 *
 * ## 为什么用打标而非「按评分排序」
 *
 * 评分高 ≠ 评测有用（有人给 5 星但只写「好」，有人给 2 星却写清了踩坑细节）。
 * 打标是读者对「信息价值」的独立判断，与作者给通告的评分互不干扰。
 *
 * ## 身份与防刷
 *
 * 复用游客评测那一套身份体系（`guestIdentity`）——**任何访客都能打标，无需登录**：
 *   - 登录用户 → `digest(fp:u<id>)`
 *   - 游客     → `digest(fp:v<visitor_cookie>|<ua>)`
 *
 * 但打标**没有审核兜底**（即时生效），所以仅靠 cookie 判重不够：
 * 清掉 cookie 就能重复计数，「有用」数会失去可信度。故加一道
 * **同 IP 同评测最多计入 3 个**（容忍同一出口网络下的几个人，同时把刷量成本抬到不划算）。
 * 注意这只是**计数上限**，不是拒绝请求 —— 第 4 个同 IP 的打标不落库、也不报错，
 * 静默返回当前计数，避免把正常用户挡在门外造成困惑。
 */
import type Database from 'better-sqlite3'
import { guestIdentity, optionalAuthLoose } from './guest-reviews'
import { checkRateLimit } from './rate-limit'
import type { EditOpResult } from './token-deals'

type DB = Database.Database

/** 打标相关上限 */
export const MARK_LIMITS = {
  /** 同一 IP 对同一条评测最多计入的打标数 */
  perIpPerReview: 3,
  /** 每身份每小时最多打标次数（跨评测累计，防脚本刷） */
  perIdentityPerHour: 60,
} as const

/** 评测 ID 前缀 → 数据来源。与 `reviews.get.ts` 的序列化前缀严格对应。 */
const USER_PREFIX = 'u_'
const GUEST_PREFIX = 'g_'

/**
 * 解析评测 ID 并确认该评测**当前公开可见**。
 *
 * 必须校验可见性：否则可以给一条还没过审（甚至已被驳回）的游客评测打标，
 * 等于通过计数侧信道确认「某人提交过评测」。
 *
 * @returns 归属的 deal_id；不存在或不可见时返回 null
 */
function resolveVisibleReview(db: DB, dealId: string, reviewId: string): string | null {
  if (reviewId.startsWith(USER_PREFIX)) {
    const raw = Number(reviewId.slice(USER_PREFIX.length))
    if (!Number.isInteger(raw) || raw <= 0) return null
    const row = db.prepare(
      'SELECT deal_id FROM token_deal_reviews WHERE id = ?'
    ).get(raw) as { deal_id: string } | undefined
    return row?.deal_id === dealId ? row.deal_id : null
  }

  if (reviewId.startsWith(GUEST_PREFIX)) {
    const raw = reviewId.slice(GUEST_PREFIX.length)
    if (!raw) return null
    const row = db.prepare(
      "SELECT deal_id FROM token_deal_guest_reviews WHERE id = ? AND status = 'approved'"
    ).get(raw) as { deal_id: string } | undefined
    return row?.deal_id === dealId ? row.deal_id : null
  }

  return null
}

/**
 * 切换打标状态（点一次标上，再点一次取消）。
 *
 * 顺序：通告存在性 → 评测可见性 → 限频 → 身份解析 → 切换 → 计数。
 * 限频放在写库前、可见性校验后，使「打标不存在的评测」不消耗配额。
 */
export function toggleReviewMark(
  db: DB,
  event: any,
  rawDealId: unknown,
  rawReviewId: unknown,
): EditOpResult<{ review_id: string; marked: boolean; mark_count: number }> {
  const dealId = String(rawDealId ?? '').trim()
  const reviewId = String(rawReviewId ?? '').trim()
  if (!dealId) return { ok: false, status: 400, error: '通告 ID 不能为空' }
  if (!reviewId) return { ok: false, status: 400, error: '评测 ID 不能为空' }

  const deal = db.prepare('SELECT id FROM token_deals WHERE id = ?').get(dealId)
  if (!deal) return { ok: false, status: 404, error: '通告不存在' }

  const ownerDealId = resolveVisibleReview(db, dealId, reviewId)
  if (!ownerDealId) return { ok: false, status: 404, error: '评测不存在' }

  const viewer = optionalAuthLoose(event)
  const { fingerprint, ipHash } = guestIdentity(event, viewer?.id ?? null)

  // 限频键用指纹而非 IP —— 身份粒度更准，且不受「同一出口网络多人共用」影响
  try {
    checkRateLimit(
      `review_mark:${fingerprint}`,
      MARK_LIMITS.perIdentityPerHour,
      60 * 60 * 1000,
    )
  } catch {
    return { ok: false, status: 429, error: '操作过于频繁，请稍后再试' }
  }

  const existing = db.prepare(
    'SELECT id FROM token_deal_review_marks WHERE review_id = ? AND fingerprint = ?'
  ).get(reviewId, fingerprint) as { id: number } | undefined

  const now = Date.now()
  let marked: boolean

  if (existing) {
    db.prepare('DELETE FROM token_deal_review_marks WHERE id = ?').run(existing.id)
    marked = false
  } else {
    // 同 IP 计数上限：超限时静默不落库（前端仍看到计数不变，不报错）
    const ipCount = db.prepare(
      'SELECT COUNT(*) AS c FROM token_deal_review_marks WHERE review_id = ? AND ip_hash = ?'
    ).get(reviewId, ipHash) as { c: number }

    if ((ipCount?.c || 0) >= MARK_LIMITS.perIpPerReview) {
      const total = db.prepare(
        'SELECT COUNT(*) AS c FROM token_deal_review_marks WHERE review_id = ?'
      ).get(reviewId) as { c: number }
      return {
        ok: true,
        data: { review_id: reviewId, marked: false, mark_count: total?.c || 0 },
      }
    }

    db.prepare(
      `INSERT OR IGNORE INTO token_deal_review_marks
         (deal_id, review_id, user_id, fingerprint, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(dealId, reviewId, viewer?.id ?? null, fingerprint, ipHash, now)
    marked = true
  }

  const total = db.prepare(
    'SELECT COUNT(*) AS c FROM token_deal_review_marks WHERE review_id = ?'
  ).get(reviewId) as { c: number }

  return {
    ok: true,
    data: { review_id: reviewId, marked, mark_count: total?.c || 0 },
  }
}

/**
 * 批量取一页评测的打标计数与「我标过没」。
 *
 * 评测列表一次要渲染 N 条，逐条查询会打出 N 次 SQL；故用 `IN (...)` 一次取回。
 * 表缺失（旧库未迁移）时降级为空统计，不阻断评测列表。
 *
 * @param fingerprint 当前访客身份摘要（未登录访客也有，由 cookie 派生）
 */
export function reviewMarkStats(
  db: DB,
  reviewIds: string[],
  fingerprint: string,
): { counts: Record<string, number>; mine: Set<string> } {
  const counts: Record<string, number> = {}
  const mine = new Set<string>()
  if (!reviewIds.length) return { counts, mine }

  const placeholders = reviewIds.map(() => '?').join(',')
  try {
    const rows = db.prepare(
      `SELECT review_id, COUNT(*) AS c FROM token_deal_review_marks
       WHERE review_id IN (${placeholders}) GROUP BY review_id`
    ).all(...reviewIds) as { review_id: string; c: number }[]
    for (const r of rows) counts[r.review_id] = r.c

    const mineRows = db.prepare(
      `SELECT review_id FROM token_deal_review_marks
       WHERE fingerprint = ? AND review_id IN (${placeholders})`
    ).all(fingerprint, ...reviewIds) as { review_id: string }[]
    for (const r of mineRows) mine.add(r.review_id)
  } catch {
    // 表未迁移 → 返回空统计（前端显示 0，功能静默降级）
  }

  return { counts, mine }
}

/** 当前访客的身份摘要 —— 供端点复用，避免各端点重复解析身份 */
export function currentFingerprint(event: any): string {
  const viewer = optionalAuthLoose(event)
  return guestIdentity(event, viewer?.id ?? null).fingerprint
}

/** 某条评测的打标数（单条场景，如审核面板） */
export function markCountOf(db: DB, reviewId: string): number {
  try {
    const row = db.prepare(
      'SELECT COUNT(*) AS c FROM token_deal_review_marks WHERE review_id = ?'
    ).get(reviewId) as { c: number }
    return row?.c || 0
  } catch {
    return 0
  }
}

// ─── 级联清理 ───────────────────────────────────────────────────
//
// 本表 `review_id` 跨 `token_deal_reviews`（登录评测）与 `token_deal_guest_reviews`
// （游客评测）两张表，**无法建外键** → 数据库不会自动级联，所有清理都必须显式做。
// 漏一处就会留下孤儿打标行：计数虚高、且该 review_id 被复用时计数会错误继承。

/** 清理某条评测的打标行（评测被删除/撤回时调用） */
export function deleteMarksForReview(db: DB, reviewId: string): void {
  try {
    db.prepare('DELETE FROM token_deal_review_marks WHERE review_id = ?').run(reviewId)
  } catch { /* 表未迁移时忽略 */ }
}

/**
 * 清理某通告下全部打标行（通告被删除时调用）。
 *
 * 按 `deal_id` 一次清完，比逐个 review_id 清更稳 —— 不依赖「先查出该通告有哪些评测」，
 * 即便此前已产生孤儿行也能一并清掉。
 */
export function deleteMarksForDeal(db: DB, dealId: string): void {
  try {
    db.prepare('DELETE FROM token_deal_review_marks WHERE deal_id = ?').run(dealId)
  } catch { /* 表未迁移时忽略 */ }
}

/**
 * 清理某用户相关的全部打标行（删除用户时调用）。
 *
 * 两个维度都要清：
 *   1. **他打出去的标** —— `user_id = ?`
 *   2. **打在他评测上的标** —— 他的登录评测会被 FK 级联删除（`token_deal_reviews`
 *      带 `ON DELETE CASCADE`），但打标行不跟着走，必须先把这些 review_id 的标清掉。
 *      游客评测表无 user 外键（设计如此，避免删用户连带删评测），故不在此列。
 */
export function deleteMarksForUser(db: DB, userId: number): void {
  try {
    const rows = db.prepare(
      'SELECT id FROM token_deal_reviews WHERE user_id = ?'
    ).all(userId) as { id: number }[]

    for (const r of rows) {
      db.prepare('DELETE FROM token_deal_review_marks WHERE review_id = ?').run(`${USER_PREFIX}${r.id}`)
    }
    db.prepare('DELETE FROM token_deal_review_marks WHERE user_id = ?').run(userId)
  } catch { /* 表未迁移时忽略 */ }
}
