/**
 * Token 白嫖通告 — 可用性投票服务层（登录 / 游客双路径）
 *
 * ## 为什么需要本模块
 *
 * 同一个「社区健康度」区块里三个维度原本规则不一：
 *   - 可用性投票（还能用/已失效）→ `requireAuth`，**必须登录**
 *   - 星级评分                   → 游客可评（游客评测）
 *   - 打标（有用）               → 任何访客可打
 *
 * 结果是按钮下方提示写着「无需登录也能评测」，旁边的投票按钮却弹「请先登录」——
 * 同一区块三套规则，用户必然困惑。本模块把投票补齐到与其他两维一致：
 * **任何人可投票，无需登录**。
 *
 * ## 双表设计（只增不改）
 *
 * 既有 `token_deal_votes.user_id` 是 `NOT NULL` + `FK→users`，**结构上无法容纳游客**，
 * 且已有真实数据。故不动它：
 *   - 登录用户 → 写 `token_deal_votes`（沿用原表，历史数据无缝）
 *   - 游客     → 写 `token_deal_guest_votes`（新表，身份靠指纹）
 *   - 计数     → `syncDealCounters` 聚合两表
 *
 * 「一人一票、可改可撤」的语义在两表内各自成立；登录态变化时（登录/登出）
 * 会视为不同身份，这与游客评测/打标的行为一致。
 *
 * ## 防刷
 *
 * 投票结果是**直接展示在列表卡片上的显眼数字**，比打标计数更值得刷。
 * 仅靠 cookie 判重会被「清 cookie 重刷」绕过，故限制
 * **同一 IP 对同一通告最多计入 3 票**（容忍同一出口网络下的几个人）。
 * 超限时**静默不落库、不报错**，静默返回当前计数，避免把正常用户挡在门外。
 */
import type Database from 'better-sqlite3'
import { guestIdentity, optionalAuthLoose } from './guest-reviews'
import { checkRateLimit } from './rate-limit'
import { syncDealCounters } from './token-deals'
import type { EditOpResult } from './token-deals'

type DB = Database.Database

/** 投票相关上限 */
export const VOTE_LIMITS = {
  /** 同一 IP 对同一通告最多计入的票数 */
  perIpPerDeal: 3,
  /** 每身份每小时最多投票次数（跨通告累计，防脚本刷） */
  perIdentityPerHour: 120,
} as const

export type VoteDirection = 'up' | 'down'

/** 校验投票方向取值 */
export function normalizeVote(value: unknown): VoteDirection | null {
  const v = String(value ?? '')
  return v === 'up' || v === 'down' ? v : null
}

/**
 * 切换投票状态（点一次投上，再点同方向取消，点反方向改票）。
 *
 * 顺序：通告存在性 → 参数校验 → 限频 → 身份解析 → 切换 → 重算计数。
 * 限频放在写库前、校验后，使非法请求不消耗配额。
 *
 * @param viewerId 已登录用户 id；null 表示游客（走游客表 + IP 上限）
 */
export function toggleDealVote(
  db: DB,
  event: any,
  rawDealId: unknown,
  rawVote: unknown,
): EditOpResult<{ my_vote: VoteDirection | null; vote_up: number; vote_down: number }> {
  const dealId = String(rawDealId ?? '').trim()
  if (!dealId) return { ok: false, status: 400, error: '通告 ID 不能为空' }

  const vote = normalizeVote(rawVote)
  if (!vote) return { ok: false, status: 400, error: '投票取值必须是 up 或 down' }

  const deal = db.prepare('SELECT id FROM token_deals WHERE id = ?').get(dealId)
  if (!deal) return { ok: false, status: 404, error: '通告不存在' }

  const viewer = optionalAuthLoose(event)
  const { fingerprint, ipHash } = guestIdentity(event, viewer?.id ?? null)

  // 限频键用指纹而非 IP —— 身份粒度更准，且不受「同一出口网络多人共用」影响
  try {
    checkRateLimit(
      `deal_vote:${fingerprint}`,
      VOTE_LIMITS.perIdentityPerHour,
      60 * 60 * 1000,
    )
  } catch {
    return { ok: false, status: 429, error: '操作过于频繁，请稍后再试' }
  }

  const now = Date.now()
  let myVote: VoteDirection | null = vote

  try {
    db.transaction(() => {
      if (viewer?.id) {
        // ── 登录用户：沿用既有 token_deal_votes 表 ──
        const existing = db.prepare(
          'SELECT id, vote FROM token_deal_votes WHERE deal_id = ? AND user_id = ?'
        ).get(dealId, viewer.id) as { id: number; vote: string } | undefined

        if (!existing) {
          db.prepare(
            `INSERT INTO token_deal_votes (deal_id, user_id, vote, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(dealId, viewer.id, vote, now, now)
        } else if (existing.vote === vote) {
          // 再点同一方向 = 取消投票
          db.prepare('DELETE FROM token_deal_votes WHERE id = ?').run(existing.id)
          myVote = null
        } else {
          db.prepare('UPDATE token_deal_votes SET vote = ?, updated_at = ? WHERE id = ?')
            .run(vote, now, existing.id)
        }
      } else {
        // ── 游客：写新表，身份靠指纹，另有同 IP 上限 ──
        const existing = db.prepare(
          'SELECT id, vote FROM token_deal_guest_votes WHERE deal_id = ? AND fingerprint = ?'
        ).get(dealId, fingerprint) as { id: number; vote: string } | undefined

        if (!existing) {
          const ipCount = db.prepare(
            'SELECT COUNT(*) AS c FROM token_deal_guest_votes WHERE deal_id = ? AND ip_hash = ?'
          ).get(dealId, ipHash) as { c: number }

          if ((ipCount?.c || 0) >= VOTE_LIMITS.perIpPerDeal) {
            // 超限：静默不落库（不报错），myVote 视为未投
            myVote = null
            return
          }

          db.prepare(
            `INSERT OR IGNORE INTO token_deal_guest_votes
               (deal_id, fingerprint, ip_hash, vote, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(dealId, fingerprint, ipHash, vote, now, now)
        } else if (existing.vote === vote) {
          db.prepare('DELETE FROM token_deal_guest_votes WHERE id = ?').run(existing.id)
          myVote = null
        } else {
          db.prepare('UPDATE token_deal_guest_votes SET vote = ?, updated_at = ? WHERE id = ?')
            .run(vote, now, existing.id)
        }
      }

      syncDealCounters(db, dealId)
    })()
  } catch (err: any) {
    console.error('投票失败:', err)
    return { ok: false, status: 500, error: err.message || '投票失败' }
  }

  const counters = db.prepare('SELECT vote_up, vote_down FROM token_deals WHERE id = ?')
    .get(dealId) as { vote_up: number; vote_down: number } | undefined

  return {
    ok: true,
    data: {
      my_vote: myVote,
      vote_up: counters?.vote_up ?? 0,
      vote_down: counters?.vote_down ?? 0,
    },
  }
}

/**
 * 读取当前访客在指定通告上的投票方向。
 *
 * 登录用户查原表，游客查游客表 —— 详情端点用它填充 `my_vote`，
 * 使按钮高亮状态对游客同样生效。
 */
export function myVoteFor(
  db: DB,
  event: any,
  dealId: string,
  viewerId: number | null,
): VoteDirection | null {
  try {
    if (viewerId) {
      const row = db.prepare(
        'SELECT vote FROM token_deal_votes WHERE deal_id = ? AND user_id = ?'
      ).get(dealId, viewerId) as { vote: string } | undefined
      return normalizeVote(row?.vote)
    }
    const { fingerprint } = guestIdentity(event, null)
    const row = db.prepare(
      'SELECT vote FROM token_deal_guest_votes WHERE deal_id = ? AND fingerprint = ?'
    ).get(dealId, fingerprint) as { vote: string } | undefined
    return normalizeVote(row?.vote)
  } catch {
    // 游客表未迁移（旧库）时降级为未投票，不阻断详情
    return null
  }
}

// ─── 级联清理 ───────────────────────────────────────────────────

/** 删除某通告的全部游客投票 —— 删通告时必须调用（本表无外键，不会自动级联） */
export function deleteGuestVotesForDeal(db: DB, dealId: string): number {
  try {
    return db.prepare('DELETE FROM token_deal_guest_votes WHERE deal_id = ?').run(dealId).changes
  } catch {
    return 0
  }
}

/** 按身份清理游客投票 —— 供「同人清理」类运维使用 */
export function deleteGuestVotesForFingerprint(db: DB, fingerprint: string): number {
  try {
    return db.prepare('DELETE FROM token_deal_guest_votes WHERE fingerprint = ?').run(fingerprint).changes
  } catch {
    return 0
  }
}
