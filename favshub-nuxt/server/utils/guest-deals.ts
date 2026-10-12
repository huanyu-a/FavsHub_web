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
 *   3. 限频 —— **同一 IP 每天 1 条**（DB 持久化，重启不丢）
 *      + 每指纹在审通告上限 + 同地址去重
 *   4. 后置审核 —— 默认 pending，管理员通过后才公开
 */
import type Database from 'better-sqlite3'
import { consumeGuestChallenge, guestIdentity, GUEST_LIMITS, hasGuestSpam } from './guest-reviews'
import { newDealId, validateDealPayload, type DealPayload } from './token-deals'

type DB = Database.Database

/** 游客通告专属上限（人机校验与昵称长度沿用 GUEST_LIMITS） */
export const GUEST_DEAL_LIMITS = {
  /** 每指纹同时在审（pending）的通告上限 —— 防单访客刷满待审队列 */
  pendingPerFingerprint: 3,
  /** 每 IP 每天的提交上限 —— 游客发布按「一 IP 一天一条」收口 */
  perIpPerDay: 1,
  /** 配额窗口长度（毫秒）—— 滚动 24h，跨自然天边界不出现「23:59 + 00:01」双发 */
  windowMs: 24 * 60 * 60 * 1000,
} as const

export type GuestDealResult =
  | { ok: true; data: { dealId: string; nickname: string; title: string } }
  | { ok: false; status: number; error: string }

/**
 * 该 IP 是否已用掉当日配额。
 *
 * 返回 `null` = 可提交；否则返回「还需等待多少毫秒」（用于提示用户）。
 * 采用**滚动 24h** 窗口（以 `last_at`，即最近一次成功提交为基准）而非自然天：
 * 后者会在「23:59 发一条、00:01 再发一条」上出现双发漏洞。
 */
function guestQuotaBlocked(db: DB, ipHash: string): number | null {
  const row = db.prepare('SELECT last_at FROM guest_submit_quota WHERE ip_hash = ?')
    .get(ipHash) as { last_at: number } | undefined
  if (!row?.last_at) return null
  const wait = GUEST_DEAL_LIMITS.windowMs - (Date.now() - row.last_at)
  return wait > 0 ? wait : null
}

/** 配额不足时给用户看的话术（剩余时间取整到小时，至少 1 小时） */
function quotaErrorText(waitMs: number): string {
  const hours = Math.max(1, Math.ceil(waitMs / (60 * 60 * 1000)))
  return `每个 IP 每天只能提交 ${GUEST_DEAL_LIMITS.perIpPerDay} 条通告，请约 ${hours} 小时后再试`
}

/**
 * 游客提交一条通告。
 *
 * 流程：字段校验 → 每日配额预检 → 人机校验（答对即作废）→ 内容过滤
 *       → 去重与在审上限 → 事务落库（通告行 + 配额行）。
 * 顺序要点：字段校验与配额查询都无副作用且廉价，排在前面；
 * 人机校验是一次性消耗，故放在配额之后 —— 配额就够拒的请求不浪费一道题。
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

  // ── 3. 每日配额预检（同一 IP 每天 1 条）──
  // 刻意放在人机校验之前：配额判定只是一次廉价查询，先拦下就不消耗一次性校验题。
  const { ipHash, fingerprint } = guestIdentity(event, null)
  const quotaWait = guestQuotaBlocked(db, ipHash)
  if (quotaWait !== null) {
    return { ok: false, status: 429, error: quotaErrorText(quotaWait) }
  }

  // ── 4. 人机校验（答对即作废）──
  const challengeError = consumeGuestChallenge(body?.challenge_token, body?.challenge_answer)
  if (challengeError) return { ok: false, status: 400, error: challengeError }

  // ── 5. 内容过滤：灌水 / 广告黑名单 ──
  const spamText = [d.provider, d.title, d.quota, d.note, d.models.join(' ')].join('\n')
  if (hasGuestSpam(spamText)) {
    return { ok: false, status: 400, error: '内容包含疑似广告或违规信息，请修改后重试' }
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
  // 配额行与通告行走**同一事务**：只有真正落库成功才占用当日配额，
  // 后面的地址去重 / 在审上限若失败，游客不会被白锁 24 小时。
  const id = newDealId()
  const now = Date.now()
  try {
    db.transaction(() => {
      // 事务内复核：预检之后到落库之前，配额可能已被其它请求占掉
      const blocked = guestQuotaBlocked(db, ipHash)
      if (blocked !== null) {
        const err: any = new Error('GUEST_QUOTA_BLOCKED')
        err.waitMs = blocked
        throw err
      }
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
      // 占用配额：同 IP 只保留最近一次成功提交的时间
      db.prepare('INSERT OR REPLACE INTO guest_submit_quota (ip_hash, last_at) VALUES (?, ?)')
        .run(ipHash, now)
    })()
  } catch (err: any) {
    if (err?.message === 'GUEST_QUOTA_BLOCKED') {
      return {
        ok: false,
        status: 429,
        error: quotaErrorText(err.waitMs ?? GUEST_DEAL_LIMITS.windowMs),
      }
    }
    console.error('游客发布 Token 白嫖通告失败:', err)
    return { ok: false, status: 500, error: err?.message || '发布失败' }
  }

  return { ok: true, data: { dealId: id, nickname, title: d.title } }
}
