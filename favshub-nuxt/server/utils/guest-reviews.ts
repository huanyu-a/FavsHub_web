/**
 * Token 白嫖通告 — 游客评测服务层
 *
 * ## 背景
 *
 * 站点主体是个人开发者，**拿不到社交登录资质**（微信开放平台网站应用须企业主体，
 * QQ 互联要求备案主体与申请主体一致），所以「游客用 QQ/微信快捷登录后评论」不可行。
 *
 * 替代方案：**游客匿名评测** —— 不登录也能留下评测，用「人机校验 + 双层限频 + 后置审核」
 * 兜住内容质量。评测**默认 pending**，由通告作者或管理员审核通过后才公开、才计入评分。
 *
 * ## 与登录用户评测的关系
 *
 * 登录用户的评测走 `token_deal_reviews`（一人一评，直接生效）；
 * 游客评测走 `token_deal_guest_reviews`（默认待审）。**两张表并存，读取时合并**：
 *   - 评分计数：仅 `status='approved'` 的游客评测计入 `rating_sum` / `rating_count`
 *   - 列表展示：登录用户评测 + 已通过游客评测按时间混排
 *
 * 登录用户也可走本表（想用不同昵称/头像时），此时 `user_id` 记下其 id 供追溯。
 *
 * ## 防滥用四层
 *
 *   1. **人机校验** —— 服务端出算术题，答案以 HMAC 签名令牌下发，无需 session 与外部服务
 *   2. **双层限频** —— 每 IP 每小时 N 条 + 每 IP 每通告终身 1 条（后者靠指纹去重实现）
 *   3. **内容过滤** —— 长度、链接数、灌水词
 *   4. **后置审核** —— 默认 pending，作者/管理员审核
 */
import type Database from 'better-sqlite3'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getCookie, getHeader, setCookie } from 'h3'
import { canReviewDeal, syncDealCounters, type EditOpResult } from './token-deals'
import { normalizeViewer as normalizeViewerLocal } from './deal-edits'
import { isUserAdmin as isUserAdminLocal } from './ai-service'
import { optionalAuth } from './auth'
import { checkRateLimit, getClientIP } from './rate-limit'
import { avatarUrl, digest, encryptQQ, isValidQQ } from './avatar'
import { getSecret } from './jwt'

type DB = Database.Database

/** 访客标识 cookie 名（第一方匿名 id，不含任何个人信息） */
const VISITOR_COOKIE = 'favshub_visitor'
const VISITOR_TTL_MS = 365 * 24 * 60 * 60 * 1000

// ─── 常量 ───────────────────────────────────────────────────────

export const GUEST_LIMITS = {
  nickname: 24,
  content: 1000,
  /** 内容里允许的最大链接数 —— 超过视为广告 */
  links: 2,
  /** 每 IP 每小时的提交上限 */
  perIpPerHour: 3,
  /** 人机校验令牌有效期 */
  challengeTtlMs: 10 * 60 * 1000,
  /** 每通告每 IP 最多保留的评测数（去重维度：deal + ip） */
  perDealPerIp: 1,
} as const

/** 灌水/广告词黑名单（命中即拒，不做模糊匹配以免误伤正常表达） */
const SPAM_PATTERNS = [
  /加\s*(微信|VX|vx|QQ|qq|群)/,
  /(免费|大量|专业)\s*(代|刷|接)\s*(充|单|量)/,
  /http[^\s]{0,4}:\/\/[^\s]*\.(?:top|xyz|icu|buzz|click)\b/i,
  /(点击|访问)\s*下方?\s*(链接|广告)/,
  /(博彩|赌场|色情|代开发票|办证)/,
]

// ─── 人机校验 ───────────────────────────────────────────────────

interface ChallengePayload {
  /** 正确答案 */
  a: number
  /** 过期时间戳 */
  e: number
  /** 一次性随机数（防重放，虽无 session 但可配合限频降低价值） */
  n: string
}

/** 校验令牌签名（复用 digest 派生密钥，按用途分离） */
function challengeKey(): Buffer {
  return createHmac('sha256', getSecret()).update('favshub:guest-challenge:v1').digest()
}

/**
 * 已用过的校验题 nonce —— 保证**一题只用一次**。
 *
 * 令牌本身无状态（服务端不存 session），若允许重复使用，脚本解一次题就能反复提交。
 * 配合 IP 限频（3 条/小时）已能挡住大部分滥用，这里再加一道「答题即作废」，
 * 让每次提交都必须真正重新解题。内存 Map + 定期清理，重启即失效（可接受：
 * 重启后旧令牌最多还能用一次，影响可忽略）。
 */
const usedNonces = new Map<string, number>()

function markNonceUsed(nonce: string, expiresAt: number): void {
  usedNonces.set(nonce, expiresAt)
  // 惰性清理：条目数超阈值时清掉已过期的，避免无界增长
  if (usedNonces.size > 5000) {
    const now = Date.now()
    for (const [n, exp] of usedNonces) {
      if (exp < now) usedNonces.delete(n)
    }
  }
}

function signChallenge(payload: ChallengePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', challengeKey()).update(body).digest('base64url').slice(0, 24)
  return `${body}.${sig}`
}

function verifyChallenge(token: string): ChallengePayload | null {
  try {
    const idx = token.lastIndexOf('.')
    if (idx <= 0) return null
    const body = token.slice(0, idx)
    const sig = token.slice(idx + 1)
    const expect = createHmac('sha256', challengeKey()).update(body).digest('base64url').slice(0, 24)
    // 定长比较防时序侧信道
    const a = Buffer.from(sig)
    const b = Buffer.from(expect)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ChallengePayload
    if (typeof payload?.a !== 'number' || typeof payload?.e !== 'number') return null
    if (Date.now() > payload.e) return null
    return payload
  } catch {
    return null
  }
}

/**
 * 生成一道算术题。答案随令牌签名下发，服务端不存状态 ——
 * 零依赖、零 session，重启也不影响在途挑战。
 */
export function createGuestChallenge(): { question: string; token: string; expires_in: number } {
  const a = 2 + Math.floor(Math.random() * 8)
  const b = 2 + Math.floor(Math.random() * 8)
  // 随机加减，避免「只会加法」被脚本批量刷
  const plus = Math.random() < 0.5
  const left = plus ? a : Math.max(a, b)
  const right = plus ? b : Math.min(a, b)
  const answer = plus ? left + right : left - right

  const token = signChallenge({
    a: answer,
    e: Date.now() + GUEST_LIMITS.challengeTtlMs,
    n: randomBytes(6).toString('hex'),
  })

  return {
    question: `${left} ${plus ? '+' : '−'} ${right} = ?`,
    token,
    expires_in: Math.floor(GUEST_LIMITS.challengeTtlMs / 1000),
  }
}

// ─── 内容过滤 ───────────────────────────────────────────────────

/**
 * 校验游客提交的内容。
 *
 * 返回 null 表示通过，否则返回给用户看的错误文案。
 * 这里只做「明显垃圾」的硬拒；更细的判断交给后置人工审核。
 */
function validateGuestContent(content: string): string | null {
  if (!content) return '评测内容不能为空'
  if (content.length > GUEST_LIMITS.content) return `评测内容不能超过 ${GUEST_LIMITS.content} 字`

  const links = content.match(/https?:\/\//gi)?.length ?? 0
  if (links > GUEST_LIMITS.links) return `内容中链接过多（最多 ${GUEST_LIMITS.links} 个）`

  for (const re of SPAM_PATTERNS) {
    if (re.test(content)) return '内容包含疑似广告或违规信息，请修改后重试'
  }
  return null
}

// ─── 序列化 ─────────────────────────────────────────────────────

/**
 * 组装对外返回的游客评测对象。
 *
 * **隐私要点**：绝不返回 QQ 号或 `qq_cipher`，只返回 `avatar` URL
 * （其路径是加密令牌，无密钥无法还原 QQ 号）。
 */
function serializeGuestReview(row: any) {
  return {
    id: row.id,
    deal_id: row.deal_id,
    nickname: row.nickname || '匿名',
    rating: row.rating,
    content: row.content,
    status: row.status,
    reject_reason: row.status === 'rejected' ? (row.reject_reason || '') : '',
    avatar: avatarUrl(row.qq_cipher),
    /** 是否为登录用户提交（前端可加标识） */
    is_user: !!row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** 取通告（含作者），不存在返回 null */
function loadDeal(db: DB, dealId: string) {
  return db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId) as any
}

/**
 * 游客标识 —— 「同一人同一通告只留一条评测」的判重依据。
 *
 * ## 为什么用第一方 cookie 而不是 IP
 *
 * 站点经「宝塔 nginx → docker nginx → 应用」双层代理。应用侧 `getRequestIP()`
 * 读的是**对端 socket 地址**，在容器网络里恒为 docker 网关地址 ——
 * 即所有访客的 IP 完全相同。若以 IP 判重，全站游客会被当成同一个人，
 * 同一通告只能存在一条游客评测，功能直接失效。
 *
 * 因此改用服务端下发的**第一方匿名 cookie**（随机 32 位 hex，不含任何个人信息）：
 * 与 IP 无关、跨代理稳定、重启后仍有效。
 *
 * ## 取舍
 *
 * cookie 可被用户清除（等于换身份）—— 匿名场景下这是可接受的：
 * 内容安全由**后置审核**兜底（默认 pending），IP 限频作为第二道防线。
 * 反过来若只信 IP，防刷强度反而更低（伪造 XFF 即可绕过）。
 *
 * 登录用户直接以 `user_id` 作为身份（更稳定，且可跨设备）。
 */
function guestIdentity(event: any, viewerId: number | null): { ipHash: string; fingerprint: string } {
  const ip = getClientIP(event)
  const ua = String(getHeader(event, 'user-agent') || '').slice(0, 300)

  let fingerprint: string
  if (viewerId) {
    fingerprint = digest(`fp:u${viewerId}`)
  } else {
    let visitorId = ''
    try {
      visitorId = String(getCookie(event, VISITOR_COOKIE) || '')
    } catch { /* 无 cookie 支持时降级 */ }

    if (!/^[a-f0-9]{32}$/.test(visitorId)) {
      visitorId = randomBytes(16).toString('hex')
      try {
        setCookie(event, VISITOR_COOKIE, visitorId, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: Math.floor(VISITOR_TTL_MS / 1000),
        })
      } catch { /* 设置失败则退化为「按 IP+UA」判重 */ }
    }
    // 加 UA 维度：同一 cookie 在不同浏览器/设备上视为不同访客（与直觉一致）
    fingerprint = digest(`fp:v${visitorId}|${ua}`)
  }

  return {
    ipHash: digest(`ip:${ip}`),
    fingerprint,
  }
}

// ─── 提交 ───────────────────────────────────────────────────────

export interface GuestReviewInput {
  nickname: unknown
  qq: unknown
  rating: unknown
  content: unknown
  challenge_token: unknown
  challenge_answer: unknown
}

/**
 * 提交游客评测。
 *
 * 流程：人机校验 → 内容过滤 → 限频 → 指纹去重（覆盖自己的 pending）→ 落库 pending。
 *
 * 注意「已通过」的评测**不允许覆盖** —— 否则同一人可反复改内容绕过审核留痕；
 * 若确需修改，应联系管理员，或等被驳回后重新提交。
 */
export function submitGuestReview(
  db: DB,
  event: any,
  rawDealId: unknown,
  body: GuestReviewInput,
): EditOpResult<{ review: any; created: boolean; message: string }> {
  const dealId = String(rawDealId ?? '').trim()
  if (!dealId) return { ok: false, status: 400, error: '通告 ID 不能为空' }

  const deal = loadDeal(db, dealId)
  if (!deal) return { ok: false, status: 404, error: '通告不存在' }
  if (deal.status !== 'approved') {
    return { ok: false, status: 404, error: '通告不存在' }
  }

  // ── 1. 人机校验 ──
  const token = String(body?.challenge_token ?? '')
  const answerRaw = body?.challenge_answer
  if (!token) return { ok: false, status: 400, error: '请先完成人机校验' }
  const challenge = verifyChallenge(token)
  if (!challenge) {
    return { ok: false, status: 400, error: '校验已过期，请刷新后重试' }
  }
  const answer = Number(answerRaw)
  if (!Number.isInteger(answer) || answer !== challenge.a) {
    return { ok: false, status: 400, error: '校验答案不正确' }
  }
  // 一题只用一次：答对即作废，防脚本解一题后反复提交
  if (usedNonces.has(challenge.n)) {
    return { ok: false, status: 400, error: '校验已使用，请重新获取题目' }
  }
  markNonceUsed(challenge.n, challenge.e)

  // ── 2. 字段校验 ──
  const rating = Number(body?.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, status: 400, error: '评分必须是 1-5 的整数' }
  }

  const nickname = String(body?.nickname ?? '').trim()
  if (!nickname) return { ok: false, status: 400, error: '请填写昵称' }
  if (nickname.length > GUEST_LIMITS.nickname) {
    return { ok: false, status: 400, error: `昵称最长 ${GUEST_LIMITS.nickname} 个字符` }
  }

  const content = String(body?.content ?? '').trim()
  const contentError = validateGuestContent(content)
  if (contentError) return { ok: false, status: 400, error: contentError }

  // QQ 号可选：填了才取头像；格式非法直接拒（不静默忽略，否则用户以为生效了）
  const qqRaw = String(body?.qq ?? '').trim()
  let qqCipher = ''
  if (qqRaw) {
    if (!isValidQQ(qqRaw)) {
      return { ok: false, status: 400, error: 'QQ 号格式不正确（5-11 位数字）' }
    }
    qqCipher = encryptQQ(qqRaw)
  }

  // ── 3. 限频（IP 维度）──
  const viewer = optionalAuthLoose(event)
  const { ipHash, fingerprint } = guestIdentity(event, viewer?.id ?? null)
  try {
    checkRateLimit(`guest_review:${ipHash}`, GUEST_LIMITS.perIpPerHour, 60 * 60 * 1000)
  } catch {
    return { ok: false, status: 429, error: '提交过于频繁，请稍后再试' }
  }

  // ── 4. 去重：同一人同一通告只留一条 ──
  // 已通过的不可覆盖（防绕过审核反复改内容）；pending 可覆盖；rejected 可重新提交（新内容重新审）
  const existing = db.prepare(`
    SELECT id, status FROM token_deal_guest_reviews
    WHERE deal_id = ? AND fingerprint = ?
    ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END
    LIMIT 1
  `).get(dealId, fingerprint) as { id: string; status: string } | undefined

  if (existing?.status === 'approved') {
    return { ok: false, status: 409, error: '你已评测过该通告，如需修改请联系管理员' }
  }

  const now = Date.now()

  if (existing) {
    db.prepare(`
      UPDATE token_deal_guest_reviews
      SET nickname = ?, qq_cipher = ?, rating = ?, content = ?,
          status = 'pending', reject_reason = '', reviewer_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(nickname, qqCipher, rating, content, now, existing.id)
    const row = db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(existing.id)
    return {
      ok: true,
      data: {
        review: serializeGuestReview(row),
        created: false,
        message: '评测已重新提交，等待审核',
      },
    }
  }

  const id = `gr_${now}_${randomBytes(4).toString('hex')}`
  db.prepare(`
    INSERT INTO token_deal_guest_reviews (
      id, deal_id, user_id, nickname, qq_cipher, rating, content,
      status, reject_reason, reviewer_id, ip_hash, fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '', NULL, ?, ?, ?, ?)
  `).run(id, dealId, viewer?.id ?? null, nickname, qqCipher, rating, content, ipHash, fingerprint, now, now)

  const row = db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(id)
  return {
    ok: true,
    data: {
      review: serializeGuestReview(row),
      created: true,
      message: '评测已提交，通过审核后展示',
    },
  }
}

// ─── 列表 ───────────────────────────────────────────────────────

/**
 * 列出某通告**已通过**的游客评测（公开可读）。
 *
 * 只返回 approved —— pending/rejected 绝不外泄（否则等于绕过审核公开内容）。
 */
export function listGuestReviews(
  db: DB,
  rawDealId: unknown,
  query: any,
): EditOpResult<{ reviews: any[]; total: number }> {
  const dealId = String(rawDealId ?? '').trim()
  if (!dealId) return { ok: false, status: 400, error: '通告 ID 不能为空' }

  const page = Math.max(1, parseInt(query?.page as string) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(query?.limit as string) || 10))
  const offset = (page - 1) * limit

  const total = (db.prepare(
    "SELECT COUNT(*) AS c FROM token_deal_guest_reviews WHERE deal_id = ? AND status = 'approved'"
  ).get(dealId) as { c: number }).c

  const rows = db.prepare(`
    SELECT * FROM token_deal_guest_reviews
    WHERE deal_id = ? AND status = 'approved'
    ORDER BY updated_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(dealId, limit, offset) as any[]

  return { ok: true, data: { reviews: rows.map(serializeGuestReview), total } }
}

/** 该通告已通过游客评测的评分分布（供前端合并评分条） */
export function guestReviewDistribution(db: DB, dealId: string): Record<number, number> {
  const rows = db.prepare(`
    SELECT rating, COUNT(*) AS count FROM token_deal_guest_reviews
    WHERE deal_id = ? AND status = 'approved' GROUP BY rating
  `).all(dealId) as { rating: number; count: number }[]

  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const r of rows) {
    if (r.rating >= 1 && r.rating <= 5) dist[r.rating] = r.count
  }
  return dist
}

// ─── 审核 ───────────────────────────────────────────────────────

/**
 * 「待我审核」的游客评测 —— 作者看自己通告上的，管理员看全部。
 *
 * 与修改提案一致：排除「自己通告上自己提的」（游客评测无此概念，但登录用户自评自己的通告
 * 也属噪音，一并排除）。
 */
export function listReviewableGuestReviews(
  db: DB,
  rawViewer: any,
  query: any,
): EditOpResult<{ reviews: any[]; total: number; scope: string }> {
  const viewer = normalizeViewerLocal(rawViewer)
  if (!viewer) return { ok: false, status: 401, error: '未登录' }

  const limit = Math.min(100, Math.max(1, parseInt(query?.limit as string) || 50))
  const page = Math.max(1, parseInt(query?.page as string) || 1)
  const offset = (page - 1) * limit

  const where = ["g.status = 'pending'", '(g.user_id IS NULL OR g.user_id != d.user_id)']
  const params: any[] = []
  if (!viewer.isAdmin) {
    where.push('d.user_id = ?')
    params.push(viewer.id)
  }
  const whereSql = where.join(' AND ')

  const total = (db.prepare(
    `SELECT COUNT(*) AS c FROM token_deal_guest_reviews g JOIN token_deals d ON d.id = g.deal_id WHERE ${whereSql}`
  ).get(...params) as { c: number }).c

  const rows = db.prepare(`
    SELECT g.*, d.provider AS deal_provider, d.title AS deal_title, d.status AS deal_status
    FROM token_deal_guest_reviews g
    JOIN token_deals d ON d.id = g.deal_id
    WHERE ${whereSql}
    ORDER BY g.created_at ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  return {
    ok: true,
    data: {
      reviews: rows.map(r => ({
        ...serializeGuestReview(r),
        deal: { id: r.deal_id, provider: r.deal_provider, title: r.deal_title, status: r.deal_status },
      })),
      total,
      scope: viewer.isAdmin ? 'all' : 'own',
    },
  }
}

/** 待审游客评测总数（用于角标） */
export function guestReviewPendingCount(db: DB, rawViewer: any): number {
  const viewer = normalizeViewerLocal(rawViewer)
  if (!viewer) return 0
  const where = ["g.status = 'pending'", '(g.user_id IS NULL OR g.user_id != d.user_id)']
  const params: any[] = []
  if (!viewer.isAdmin) {
    where.push('d.user_id = ?')
    params.push(viewer.id)
  }
  return (db.prepare(
    `SELECT COUNT(*) AS c FROM token_deal_guest_reviews g JOIN token_deals d ON d.id = g.deal_id WHERE ${where.join(' AND ')}`
  ).get(...params) as { c: number }).c
}

/**
 * 审核游客评测（通过 / 驳回）。
 *
 * **通过时必须重算主表计数** —— 评分计入是「仅 approved」的语义，
 * 状态一变计数就要跟着变，否则星级与实际评测对不上。
 */
export function reviewGuestReview(
  db: DB,
  rawViewer: any,
  rawReviewId: unknown,
  body: any,
): EditOpResult<{ review: any; message: string }> {
  const viewer = normalizeViewerLocal(rawViewer)
  if (!viewer) return { ok: false, status: 401, error: '未登录' }

  const reviewId = String(rawReviewId ?? '').trim()
  if (!reviewId) return { ok: false, status: 400, error: '评测 ID 不能为空' }

  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    return { ok: false, status: 400, error: '审核动作必须是 approve 或 reject' }
  }

  const row = db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(reviewId) as any
  if (!row) return { ok: false, status: 404, error: '评测不存在' }

  const deal = loadDeal(db, row.deal_id)
  if (!deal) return { ok: false, status: 404, error: '通告不存在' }
  if (!canReviewDeal(deal, viewer)) {
    return { ok: false, status: 404, error: '评测不存在' }
  }
  if (row.status !== 'pending') {
    return { ok: false, status: 409, error: `该评测已${row.status === 'approved' ? '通过' : '驳回'}，无需重复审核` }
  }

  const now = Date.now()
  const reason = String(body?.reason ?? '').trim().slice(0, 200)

  db.transaction(() => {
    db.prepare(`
      UPDATE token_deal_guest_reviews
      SET status = ?, reviewer_id = ?, reject_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(action === 'approve' ? 'approved' : 'rejected', viewer.id, action === 'reject' ? reason : '', now, reviewId)

    // 计数随状态变化重算（仅 approved 计入）
    syncDealCounters(db, row.deal_id)
  })()

  const updated = db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(reviewId)
  return {
    ok: true,
    data: {
      review: serializeGuestReview(updated),
      message: action === 'approve' ? '已通过，该评测已公开并计入评分' : '已驳回该评测',
    },
  }
}

/** 撤回自己的待审游客评测（按 id + 指纹校验归属） */
export function withdrawGuestReview(
  db: DB,
  event: any,
  rawReviewId: unknown,
): EditOpResult<{ id: string }> {
  const reviewId = String(rawReviewId ?? '').trim()
  if (!reviewId) return { ok: false, status: 400, error: '评测 ID 不能为空' }

  const row = db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(reviewId) as any
  if (!row) return { ok: false, status: 404, error: '评测不存在' }
  if (row.status !== 'pending') {
    return { ok: false, status: 409, error: '只能撤回待审核的评测' }
  }

  const viewer = optionalAuthLoose(event)
  const { fingerprint } = guestIdentity(event, viewer?.id ?? null)
  const isAdmin = !!viewer && isUserAdminLocal(db, viewer.id)
  if (row.fingerprint !== fingerprint && !isAdmin) {
    return { ok: false, status: 404, error: '评测不存在' }
  }

  db.prepare('DELETE FROM token_deal_guest_reviews WHERE id = ?').run(reviewId)
  return { ok: true, data: { id: reviewId } }
}

/** 详情端点用：当前访客在此通告上自己的待审评测 */
export function guestReviewSummary(db: DB, event: any, dealId: string) {
  const viewer = optionalAuthLoose(event)
  const { fingerprint } = guestIdentity(event, viewer?.id ?? null)
  const row = db.prepare(`
    SELECT * FROM token_deal_guest_reviews
    WHERE deal_id = ? AND fingerprint = ? AND status = 'pending'
  `).get(dealId, fingerprint) as any
  return row ? serializeGuestReview(row) : null
}

// ─── 局部依赖 ───────────────────────────────────────────────────

/** 容错的 optionalAuth —— 事件对象异常时视为未登录，不阻断游客流程 */
function optionalAuthLoose(event: any): { id: number } | null {
  try {
    const u = optionalAuth(event)
    return u ? { id: u.id } : null
  } catch {
    return null
  }
}
