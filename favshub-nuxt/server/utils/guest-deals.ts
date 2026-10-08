/**
 * Token 白嫖通告 — 游客发布服务层
 *
 * ## 背景
 *
 * /tokens 页面向游客开放「发布通告」：无需登录，提交后与管理员发布的
 * 普通用户通告走**同一条审核链路**（status='pending'，管理员通过才公开）。
 *
 * ## 落库方式
 *
 * 复用主表 `token_deals`（ votes / 评测 / 置顶 / 审核队列全部天然复用）：
 *   - `user_id` 固定为 **0** —— 种子系统用户 `_system`（seedDefaults 预置，
 *     password_hash 为空，任何会话都不可能映射到它），满足外键约束；
 *   - 游客署名存 `guest_name`（读取侧把它覆写为对外的 nickname）；
 *   - 身份指纹存 `guest_fingerprint`（与游客评测同一套 cookie+UA 体系），
 *     用于「同一访客在审通告数」上限；
 *   - 游客无法登录，因此编辑 / 重提只在管理员侧进行；驳回后游客重新提交即可。
 *
 * ## 防滥用四层（与游客评测同源）
 *
 *   1. 人机校验 —— HMAC 签名算术题，一题一用（consumeGuestChallenge）
 *   2. 内容过滤 —— 灌水 / 广告黑名单（hasGuestSpam）+ validateDealPayload 字段校验
 *   3. 双层限频 —— 每 IP 每小时 N 条 + 每指纹在审通告上限 + 同地址去重
 *   4. 后置审核 —— 默认 pending，管理员通过后才公开
 */
import type Database from 'better-sqlite3'
import { consumeGuestChallenge, guestIdentity, GUEST_LIMITS, hasGuestSpam } from './guest-reviews'
import { checkRateLimit } from './rate-limit'
import { newDealId, validateDealPayload, type DealPayload } from './token-deals'

type DB = Database.Database

/** 游客通告专属上限（人机校验与昵称长度沿用 GUEST_LIMITS） */
export const GUEST_DEAL_LIMITS = {
  /** 每指纹同时在审（pending）的通告上限 —— 防单访客刷满待审队列 */
  pendingPerFingerprint: 3,
  /** 每 IP 每小时提交上限（与游客评测一致） */
  perIpPerHour: 3,
} as const

export type GuestDealResult =
  | { ok: true; data: { dealId: string; nickname: string; title: string } }
  | { ok: false; status: number; error: string }

/**
 * 游客提交一条通告。
 *
 * 流程：字段校验 → 人机校验（答对即作废）→ 内容过滤 → 限频与去重 → 落库 pending。
 * 校验顺序刻意让「便宜的字段校验」先行，避免无谓消耗一次性校验题。
 */
export function submitGuestDeal(db: DB, event: any, body: any): GuestDealResult {
  // ── 1. 字段级校验（与登录用户同一套规则）──
  const validated = validateDealPayload(body)
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error }
  }
  const d: DealPayload = validated.data

  // ── 2. 昵称（对外署名）──
  const nickname = String(body?.nickname ?? '').trim()
  if (!nickname) return { ok: false, status: 400, error: '请填写昵称' }
  if (nickname.length > GUEST_LIMITS.nickname) {
    return { ok: false, status: 400, error: `昵称最长 ${GUEST_LIMITS.nickname} 个字符` }
  }

  // ── 3. 人机校验（答对即作废）──
  const challengeError = consumeGuestChallenge(body?.challenge_token, body?.challenge_answer)
  if (challengeError) return { ok: false, status: 400, error: challengeError }

  // ── 4. 内容过滤：灌水 / 广告黑名单 ──
  const spamText = [d.provider, d.title, d.quota, d.note, d.models.join(' ')].join('\n')
  if (hasGuestSpam(spamText)) {
    return { ok: false, status: 400, error: '内容包含疑似广告或违规信息，请修改后重试' }
  }

  // ── 5. 限频与去重 ──
  const { ipHash, fingerprint } = guestIdentity(event, null)
  try {
    checkRateLimit(`guest_deal:${ipHash}`, GUEST_DEAL_LIMITS.perIpPerHour, 60 * 60 * 1000)
  } catch {
    return { ok: false, status: 429, error: '提交过于频繁，请稍后再试' }
  }

  // 同一领取地址已有待审 / 已通过的通告 → 拒绝重复发布（驳回的不算，允许修正后重提）
  const dup = db.prepare(`
    SELECT id FROM token_deals WHERE url = ? AND status IN ('pending', 'approved') LIMIT 1
  `).get(d.url) as { id: string } | undefined
  if (dup) {
    return { ok: false, status: 409, error: '该领取地址已有通告（待审或已通过），请勿重复发布' }
  }

  // 每指纹在审通告上限 —— 单个访客最多同时挂 N 条待审
  const pendingCount = (db.prepare(
    "SELECT COUNT(*) AS c FROM token_deals WHERE guest_fingerprint = ? AND status = 'pending'"
  ).get(fingerprint) as { c: number }).c
  if (pendingCount >= GUEST_DEAL_LIMITS.pendingPerFingerprint) {
    return {
      ok: false,
      status: 409,
      error: `你已有 ${pendingCount} 条待审核的通告，请等待审核结果后再发布`,
    }
  }

  // ── 6. 落库：pending，等待管理员审核 ──
  const id = newDealId()
  const now = Date.now()
  try {
    db.prepare(`
      INSERT INTO token_deals (
        id, user_id, provider, title, url, call_url, quota, models, region, quality,
        source_tag, expires_at, pinned, note, status, reject_reason,
        vote_up, vote_down, rating_sum, rating_count, created_at, updated_at,
        guest_name, guest_fingerprint
      ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', '', 0, 0, 0, 0, ?, ?, ?, ?)
    `).run(
      id, d.provider, d.title, d.url, d.callUrl, d.quota,
      JSON.stringify(d.models), d.region, d.quality, d.sourceTag,
      d.expiresAt, d.note, now, now, nickname, fingerprint,
    )
  } catch (err: any) {
    console.error('游客发布 Token 白嫖通告失败:', err)
    return { ok: false, status: 500, error: err?.message || '发布失败' }
  }

  return { ok: true, data: { dealId: id, nickname, title: d.title } }
}
