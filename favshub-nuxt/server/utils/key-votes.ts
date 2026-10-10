/**
 * 「福利 Key」— 可用性投票服务层（对照白嫖通告 deal-votes.ts）
 *
 * ## 与白嫖通告投票的差异
 *
 * token_keys 页是**纯匿名公开页**（GET /api/token-keys 与登录态零相关，
 * 才允许 CDN 公开缓存，docs/08 §4.2），没有既有「登录用户投票表」。故不照搬
 * deal-votes 的双表设计，只用一张 `token_key_votes`，身份统一走指纹：
 *   - 登录用户 → 指纹 fp:u<userId>（跨设备同一人视为同一身份）
 *   - 游客     → 指纹 fp:<visitorCookie>|<UA>（与游客评测/打标同纪律）
 * 登录态变化（登录/登出）时视为不同身份，与 deals 侧行为一致。
 *
 * ## 一人一票、可改可撤
 *
 * UNIQUE(key_id, fingerprint)：再点同方向 = 取消，点反方向 = 改票。
 * 计数为 `token_keys.vote_up / vote_down` 缓存列，投票后在同一事务内
 * `syncKeyVoteCounters` 全量重算（数据量小，直接聚合两向计数），
 * 与各端点绝不手工 ±1 的纪律一致（对照 syncDealCounters）。
 *
 * ## 防刷
 *
 * 与白嫖通告同款口径（投票计数直接展示在卡片上，比打标更值得刷）：
 *   - 同身份每小时最多 120 次投票（跨 key 累计，指纹限频）
 *   - 游客同 IP 对同一 key 最多计入 3 票（容忍同一出口网络下的几个人），
 *     超限**静默不落库、不报错**，静默返回当前计数，避免把正常用户挡在门外。
 *
 * ## 与爬虫写入的关系
 *
 * 爬虫经 POST /api/ai/token-keys 的 upsertTokenKey UPDATE / INSERT 语句均不含
 * vote_up / vote_down 两列，爬虫每轮推送不会清零投票；pruneTokenKeys 删除行时
 * 级联清理本表的孤立投票（对照 deal 删除级联清理游客投票的先例）。
 */
import type Database from 'better-sqlite3'
import { guestIdentity, optionalAuthLoose } from './guest-reviews'
import { checkRateLimit } from './rate-limit'
import type { EditOpResult } from './token-deals'

type DB = Database.Database

/** 投票相关上限（数值对照 deal-votes.ts VOTE_LIMITS，保持全站一致） */
export const KEY_VOTE_LIMITS = {
  /** 同一 IP 对同一 key 最多计入的票数（游客） */
  perIpPerKey: 3,
  /** 每身份每小时最多投票次数（跨 key 累计，防脚本刷） */
  perIdentityPerHour: 120,
} as const

export type KeyVoteDirection = 'up' | 'down'

/** 校验投票方向取值 */
export function normalizeKeyVote(value: unknown): KeyVoteDirection | null {
  const v = String(value ?? '')
  return v === 'up' || v === 'down' ? v : null
}

/**
 * 可见性口径（与 GET /api/token-keys 恒定 WHERE 同形，docs/08 §4.2）：
 * published + 非 dead + 回帖指引限 24h 内。不可见的行不可投票（404）。
 * 时间戳为秒级（沿爬虫语义）。
 */
const KEY_VISIBILITY_SQL =
  "deal_status = 'published' AND verdict != 'dead'"
  + " AND (source != 'reply_visible_guide' OR first_seen_at > ?)"

/** 回帖指引行收录窗口（秒），与 index.get.ts / copy.get.ts 同值 */
const GUIDE_WINDOW_SECONDS = 24 * 3600

/**
 * 在事务内全量重算 key 的两向投票计数（缓存列）。
 * 调用方必须已持有 token_key_votes 的写事务（toggleKeyVote 内事务包裹）。
 */
export function syncKeyVoteCounters(db: DB, keyId: string): void {
  const counts = db.prepare(
    "SELECT SUM(CASE WHEN vote = 'up' THEN 1 ELSE 0 END) AS up,"
    + " SUM(CASE WHEN vote = 'down' THEN 1 ELSE 0 END) AS down"
    + ' FROM token_key_votes WHERE key_id = ?',
  ).get(keyId) as { up: number | null, down: number | null } | undefined
  db.prepare('UPDATE token_keys SET vote_up = ?, vote_down = ? WHERE id = ?')
    .run(counts?.up ?? 0, counts?.down ?? 0, keyId)
}

/**
 * 切换投票状态（点一次投上，再点同方向取消，点反方向改票）。
 *
 * 顺序：可见性 → 参数校验 → 限频 → 身份解析 → 切换 → 重算计数。
 * 限频放在写库前、校验后，使非法请求不消耗配额。
 *
 * @param viewerId 已登录用户 id；null 表示游客（走 cookie+UA 指纹 + 同 IP 上限）
 */
export function toggleKeyVote(
  db: DB,
  event: any,
  rawKeyId: unknown,
  rawVote: unknown,
): EditOpResult<{ my_vote: KeyVoteDirection | null; vote_up: number; vote_down: number }> {
  const keyId = String(rawKeyId ?? '').trim()
  if (!keyId) return { ok: false, status: 400, error: 'Key ID 不能为空' }

  const vote = normalizeKeyVote(rawVote)
  if (!vote) return { ok: false, status: 400, error: '投票取值必须是 up 或 down' }

  // 可见性与列表同口径：不可见（下架 / 失效 / 过期指引）一律 404，不区分
  const guideCutoff = Math.floor(Date.now() / 1000) - GUIDE_WINDOW_SECONDS
  const key = db.prepare(
    'SELECT id FROM token_keys WHERE id = ? AND ' + KEY_VISIBILITY_SQL,
  ).get(keyId, guideCutoff) as { id: string } | undefined
  if (!key) return { ok: false, status: 404, error: 'Key 不存在或已下架' }

  const viewer = optionalAuthLoose(event)
  const isGuest = !viewer?.id
  const { fingerprint, ipHash } = guestIdentity(event, viewer?.id ?? null)

  // 限频键用指纹而非 IP —— 身份粒度更准（对照 deal-votes 同款注释）
  try {
    checkRateLimit(
      'key_vote:' + fingerprint,
      KEY_VOTE_LIMITS.perIdentityPerHour,
      60 * 60 * 1000,
    )
  } catch {
    return { ok: false, status: 429, error: '操作过于频繁，请稍后再试' }
  }

  const now = Date.now()
  let myVote: KeyVoteDirection | null = vote

  try {
    db.transaction(() => {
      const existing = db.prepare(
        'SELECT id, vote FROM token_key_votes WHERE key_id = ? AND fingerprint = ?',
      ).get(keyId, fingerprint) as { id: number, vote: string } | undefined

      if (!existing) {
        if (isGuest) {
          const ipCount = db.prepare(
            'SELECT COUNT(*) AS c FROM token_key_votes WHERE key_id = ? AND ip_hash = ?',
          ).get(keyId, ipHash) as { c: number }

          if ((ipCount?.c || 0) >= KEY_VOTE_LIMITS.perIpPerKey) {
            // 超限：静默不落库（不报错），myVote 视为未投
            myVote = null
            return
          }
        }

        db.prepare(
          'INSERT INTO token_key_votes (key_id, fingerprint, ip_hash, vote, created_at, updated_at)'
          + ' VALUES (?, ?, ?, ?, ?, ?)',
        ).run(keyId, fingerprint, ipHash, vote, now, now)
      } else if (existing.vote === vote) {
        // 再点同一方向 = 取消投票
        db.prepare('DELETE FROM token_key_votes WHERE id = ?').run(existing.id)
        myVote = null
      } else {
        db.prepare('UPDATE token_key_votes SET vote = ?, updated_at = ? WHERE id = ?')
          .run(vote, now, existing.id)
      }

      syncKeyVoteCounters(db, keyId)
    })()
  } catch (err: any) {
    console.error('Key 投票失败:', err)
    return { ok: false, status: 500, error: err.message || '投票失败' }
  }

  const counters = db.prepare('SELECT vote_up, vote_down FROM token_keys WHERE id = ?')
    .get(keyId) as { vote_up: number, vote_down: number } | undefined

  return {
    ok: true,
    data: {
      my_vote: myVote,
      vote_up: counters?.vote_up ?? 0,
      vote_down: counters?.vote_down ?? 0,
    },
  }
}

/** 批量读取（单语句 IN 查询，数量上限由端点层约束） */
export function myVotesForKeys(
  db: DB,
  event: any,
  keyIds: string[],
  viewerId: number | null,
): Record<string, KeyVoteDirection> {
  const out: Record<string, KeyVoteDirection> = {}
  if (!keyIds.length) return out
  try {
    const { fingerprint } = guestIdentity(event, viewerId)
    const marks = keyIds.map(() => '?').join(', ')
    const rows = db.prepare(
      'SELECT key_id, vote FROM token_key_votes WHERE key_id IN (' + marks + ') AND fingerprint = ?',
    ).all(...keyIds, fingerprint) as Array<{ key_id: string, vote: string }>
    for (const r of rows) {
      const v = normalizeKeyVote(r.vote)
      if (v) out[r.key_id] = v
    }
  } catch {
    // 游客表未迁移（旧库）时整体降级为空映射
  }
  return out
}

// ─── 级联清理 ───────────────────────────────────────────────────

/** 删除某 key 的全部投票 —— 爬虫对账清理（pruneTokenKeys）删行时调用（本表无外键） */
export function deleteKeyVotesForKeys(db: DB, keyIds: string[]): number {
  if (!keyIds.length) return 0
  try {
    const marks = keyIds.map(() => '?').join(', ')
    return db.prepare('DELETE FROM token_key_votes WHERE key_id IN (' + marks + ')').run(...keyIds).changes
  } catch {
    return 0
  }
}