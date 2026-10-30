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
 *   1. **人机校验** —— Cloudflare Turnstile（见 `./human-check`），**失败即拒绝**；
 *      未配置或关闭时游客通道整体关闭，不留算术题等降级旁路
 *   2. **双层限频** —— 每 IP 每小时 N 条 + 每 IP 每通告终身 1 条（后者靠指纹去重实现）
 *   3. **内容过滤** —— 长度、链接数、灌水词
 *   4. **后置审核** —— 默认 pending，作者/管理员审核
 *
 * ## 管理端（2026-10-30 增补）
 *
 * 管理员原本只能「通过 / 驳回」待审评测：已通过的评测在公开侧露出后**没有任何删除通道**
 * —— `DELETE /api/token-deals/:id/guest-reviews/:reviewId` 是「游客撤回自己的待审评测」，
 * 对已通过的一律 409，且是物理删除、无审计。于是违规内容一旦过审就只能改库。
 *
 * 现在补齐（全部收口在本模块）：
 *   - `listGuestReviewsForAdmin()`  四态列表 + 通告/关键字筛选 + 分页 + 各态计数
 *   - `adminActOnGuestReview()`     approve / reject / **delete（软删除）** / restore，唯一写入口
 *   - `listGuestReviewAdminActions()` 处置审计（谁 / 何时 / 对哪条 / 做了什么 / 前后状态）
 *   - `serializeGuestReviewForAdmin()` 管理端脱敏**唯一出口**（指纹 / IP 摘要 / QQ 密文 / 内部 user id 不下发）
 *   - `ensureGuestReviewSchema()` 幂等补列（deleted_at / deleted_by / deleted_status）+ 审计表
 *
 * 软删除的语义与计数口径见 `GUEST_REVIEW_DELETED_REASON` 的注释：删除 = 置 deleted_at
 * **且**把 status 降为 rejected，这样 `syncDealCounters()`（只认 approved）无需改动即正确。
 */
import type Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { createError, getCookie, getHeader, setCookie } from 'h3'
import { avatarUrl, digest, encryptQQ, isValidQQ } from './avatar'
import { canReviewDeal, escapeLike, syncDealCounters, type EditOpResult } from './token-deals'
import { normalizeViewer as normalizeViewerLocal } from './deal-edits'
import { isUserAdmin as isUserAdminLocal } from './ai-service'
import { optionalAuth } from './auth'
import { checkRateLimit, getClientIP } from './rate-limit'
import { assertHumanCheck } from './human-check'
import { hasSpamText } from './spam'

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
  /** 每通告每 IP 最多保留的评测数（去重维度：deal + ip） */
  perDealPerIp: 1,
} as const

// ─── 状态与软删除 ───────────────────────────────────────────────

/** 审核状态三态（与建表注释一致） */
export const GUEST_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export type GuestReviewStatus = (typeof GUEST_REVIEW_STATUSES)[number]

/**
 * 管理员删除的原因标记 —— 写进 `reject_reason`。
 *
 * 为什么删一条评测要动 `reject_reason`：`syncDealCounters()` 只统计
 * `status = 'approved'` 的游客评测，**它不认 `deleted_at`**（那张表不在本模块写域内）。
 * 若「删除」只置 `deleted_at` 而不改 `status`，一条已通过的评测被删后仍会计入通告评分，
 * 星级与可见评测数立刻对不上。因此删除 = `status='rejected'` + `deleted_at` + 上面的原因标记，
 * 计数随状态下调，公开侧也自动消失；恢复时把 `status` 还原成本次删除前的值。
 */
export const GUEST_REVIEW_DELETED_REASON = '[管理员删除]'

/** 软删除标记前缀 —— 用于区分「管理员删除」与「作者手动驳回」（后者不写前缀） */
const ADMIN_DELETED_REASON_PREFIX = GUEST_REVIEW_DELETED_REASON

/** 管理端处置动作（审计日志里的 `action`） */
export const GUEST_REVIEW_ADMIN_ACTIONS = ['approve', 'reject', 'delete', 'restore'] as const
export type GuestReviewAdminAction = (typeof GUEST_REVIEW_ADMIN_ACTIONS)[number]

/** 处置动作的中文标签（管理端列表「最近处置」列使用） */
export const GUEST_REVIEW_ADMIN_ACTION_LABELS: Record<string, string> = {
  approve: '通过',
  reject: '驳回',
  delete: '删除',
  restore: '恢复',
}

// ─── schema 收口 ────────────────────────────────────────────────

let guestReviewSchemaReady = false

/**
 * 游客评测表所需增量 schema 的**幂等**补齐（软删除三列 + 处置审计表）。
 *
 * ## 谁必须调它（**本模块每个读写该表的入口都要调**）
 *
 * 软删除三列是本模块在运行时补的（`server/database/migrate.ts` 不是本模块的写域，
 * 见下）。于是**任何**引用 `deleted_at` 的 SQL 都必须先确保列存在 ——
 * 漏调不会在类型检查或构建时报错，而是线上 `no such column: g.deleted_at` → 500。
 *
 * 这个坑当场踩过：既有「待审队列」端点 `GET /api/guest-reviews` 只加了
 * `g.deleted_at IS NULL` 而没调本函数，**全新库上第一次访问就 500**
 * （已有库因为管理员先访问过新列表页而不复现 —— 属于「本地看起来好的」型缺陷）。
 * 因此约定：本文件里凡是碰 `token_deal_guest_reviews` 的导出函数，第一行调它。
 * 函数内部的 `guestReviewSchemaReady` 让重复调用只剩一次布尔判断。
 *
 * ## 为什么放在这里而不是 `server/database/migrate.ts`
 *
 * 本模块的写域只到 `server/utils/guest-reviews.ts`。这里自建「存在才加」的补列逻辑：
 * 表不存在时整体跳过（由 migrate 建表），已存在但缺列时补上。**与 migrate 的
 * ensureColumn 完全同构**；将来若把这三列搬进 migrate（已报给 Lead 协调落点），
 * 这里的 guard 会自动变成空操作，不会双写冲突。
 *
 * 幂等性由两件事共同保证：模块级 `guestReviewSchemaReady` 只跑一次；
 * `PRAGMA table_xinfo` 先查后加（重复调用也不会报 duplicate column）。
 */
export function ensureGuestReviewSchema(db: DB): void {
  if (guestReviewSchemaReady) return

  const cols = (db.prepare('PRAGMA table_xinfo(token_deal_guest_reviews)').all() as { name: string }[])
    .map(c => c.name)
  if (!cols.length) return // 表还没建（migrate 未跑），交给 migrate 建表后再来

  const addColumn = (column: string, alterSQL: string) => {
    if (cols.includes(column)) return
    try {
      db.exec(alterSQL)
      console.log(`[DB] 迁移: token_deal_guest_reviews 表添加 ${column} 字段`)
    } catch (err: any) {
      console.error(`[DB] 迁移失败 token_deal_guest_reviews.${column}:`, err.message)
    }
  }

  addColumn('deleted_at', 'ALTER TABLE token_deal_guest_reviews ADD COLUMN deleted_at INTEGER DEFAULT NULL')
  addColumn('deleted_by', 'ALTER TABLE token_deal_guest_reviews ADD COLUMN deleted_by INTEGER DEFAULT NULL')
  // 删除前的审核状态：恢复时要还原回 approved / pending，而不是一律回到 pending
  addColumn('deleted_status', "ALTER TABLE token_deal_guest_reviews ADD COLUMN deleted_status TEXT DEFAULT ''")

  // ── 处置审计表 ──
  //
  // 为什么新建一张表，而不是复用既有的 `ai_audit_logs`：那张表是 **PAT / AI 通道** 的访问审计，
  // 结构上 `token_id`、`scope`、`status_code` 全是必需列，且语义是「令牌调用了哪个接口」——
  // 塞进管理端的人工处置动作会把两种语义混在一张表里，查询与保留策略都无法共用。
  //
  // 因此按本仓「核心表独立建、每条独立 try/catch」的惯例新建最小的一张；
  // 只记「谁（actor_id/actor_name）· 何时 · 对哪条（review_id/deal_id）· 做了什么（action + 前后状态）· 理由」，
  // **不存评测正文、不存 IP、不存指纹** —— 审计表不该成为第二个泄露面。
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS guest_review_admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id TEXT NOT NULL,
        deal_id TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        from_status TEXT NOT NULL DEFAULT '',
        to_status TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        actor_id INTEGER,
        actor_name TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
    `)
  } catch (err: any) {
    console.error('[DB] 创建 guest_review_admin_actions 表失败:', err.message)
  }

  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_gra_review ON guest_review_admin_actions(review_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_gra_created ON guest_review_admin_actions(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_tdgr_deleted ON token_deal_guest_reviews(deleted_at)',
  ]) {
    try {
      db.exec(sql)
    } catch (err: any) {
      console.warn('[DB] 游客评测管理索引创建失败（不影响其他索引）:', err.message)
    }
  }

  guestReviewSchemaReady = true
}

// ─── 脱敏（唯一出口）───────────────────────────────────────────

/**
 * **管理端**游客评测行 → 对外结构。
 *
 * ## 为什么必须集中在这里
 *
 * `token_deal_guest_reviews` 里有四个**只该留在库里**的字段：
 *   - `fingerprint`  —— 游客身份的关联键（同一人跨通告可被串起来，泄露即剥掉匿名性）
 *   - `ip_hash`      —— IP 摘要，同上
 *   - `qq_cipher`    —— QQ 号密文，只用于服务端解密取头像，密文本身也不下发
 *   - `user_id`      —— 登录用户提交时的内部账号 id
 *
 * 本仓的教训（`ai-service.ts` 的 `DEAL_PRIVATE_FIELDS`）是：脱敏一旦按端点各写一遍，
 * 迟早有端点漏一个 —— 那次就是 `SELECT td.*` 绕过了所有「顺手 delete」。
 * 所以管理端列表/处置响应**一律**经本函数产出，字段逐个白名单列举，
 * 新增列不会因为 `SELECT *` 而自动泄露。
 *
 * 游客身份只给展示名（`nickname`，空则「匿名」）与 `is_user` 布尔标识；
 * 头像给 `/avatar/<密文令牌>.jpg`（无密钥无法还原 QQ 号）。
 */
export function serializeGuestReviewForAdmin(row: any) {
  if (!row) return null
  const deleted = !!row.deleted_at
  const status = String(row.status || '')
  return {
    id: row.id,
    deal_id: row.deal_id,
    nickname: row.nickname || '匿名',
    rating: row.rating,
    content: row.content,
    /** 审核状态；`deleted` 是**派生**状态，与既有三态合并成管理端四态 */
    status,
    /** 四态视图：deleted | pending | approved | rejected */
    display_status: deleted ? 'deleted' : status,
    is_user: !!row.user_id,
    avatar: avatarUrl(row.qq_cipher),
    reject_reason: String(row.reject_reason || ''),
    deleted_at: row.deleted_at || null,
    deleted_by: row.deleted_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** 审计动作行（同样白名单，避免以后加列就自动下发） */
function serializeGuestReviewAdminAction(row: any) {
  if (!row) return null
  return {
    id: row.id,
    review_id: row.review_id,
    deal_id: row.deal_id,
    action: row.action,
    action_label: GUEST_REVIEW_ADMIN_ACTION_LABELS[row.action] || row.action,
    from_status: row.from_status,
    to_status: row.to_status,
    reason: row.reason,
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    created_at: row.created_at,
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

  if (hasSpamText(content)) return '内容包含疑似广告或违规信息，请修改后重试'
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

/** 取通告（含作者），不存在或已软删除返回 null */
function loadDeal(db: DB, dealId: string) {
  return db.prepare('SELECT * FROM token_deals WHERE id = ? AND deleted_at IS NULL').get(dealId) as any
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
export function guestIdentity(event: any, viewerId: number | null): { ipHash: string; fingerprint: string } {
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
  /** Cloudflare Turnstile 一次性令牌（前端挂件通过后回传） */
  turnstile_token: unknown
}

/**
 * 提交游客评测。
 *
 * 流程：人机校验 → 内容过滤 → 限频 → 指纹去重（覆盖自己的 pending）→ 落库 pending。
 *
 * 注意「已通过」的评测**不允许覆盖** —— 否则同一人可反复改内容绕过审核留痕；
 * 若确需修改，应联系管理员，或等被驳回后重新提交。
 */
export async function submitGuestReview(
  db: DB,
  event: any,
  rawDealId: unknown,
  body: GuestReviewInput,
): Promise<EditOpResult<{ review: any; created: boolean; message: string }>> {
  const dealId = String(rawDealId ?? '').trim()
  if (!dealId) return { ok: false, status: 400, error: '通告 ID 不能为空' }

  // 软删除三列是本模块运行时补的，任何引用它们的 SQL 之前都必须先确保列存在
  ensureGuestReviewSchema(db)
  const deal = loadDeal(db, dealId)
  if (!deal) return { ok: false, status: 404, error: '通告不存在' }
  if (deal.status !== 'approved') {
    return { ok: false, status: 404, error: '通告不存在' }
  }

  // ── 1. 人机校验（Turnstile；失败即拒绝，无降级）──
  const challengeError = await assertHumanCheck(event, body)
  if (challengeError) return { ok: false, status: 400, error: challengeError }

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
  // 已通过的不可覆盖（防绕过审核反复改内容）；pending 可覆盖；rejected 可重新提交（新内容重新审）。
  // 被管理员删除的行**不参与判重**：删除是定论，不能让「换个内容再提交」把删除洗白
  // （那样 deleted_at 被原地复用，审计轨迹也就断了）；重提会落一条新行，仍走完整审核。
  const existing = db.prepare(`
    SELECT id, status FROM token_deal_guest_reviews
    WHERE deal_id = ? AND fingerprint = ? AND deleted_at IS NULL
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

  // 软删除三列是本模块运行时补的，任何引用它们的 SQL 之前都必须先确保列存在
  ensureGuestReviewSchema(db)
  const page = Math.max(1, parseInt(query?.page as string) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(query?.limit as string) || 10))
  const offset = (page - 1) * limit

  const total = (db.prepare(
    "SELECT COUNT(*) AS c FROM token_deal_guest_reviews"
    + " WHERE deal_id = ? AND status = 'approved' AND deleted_at IS NULL"
  ).get(dealId) as { c: number }).c

  const rows = db.prepare(`
    SELECT * FROM token_deal_guest_reviews
    WHERE deal_id = ? AND status = 'approved' AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(dealId, limit, offset) as any[]

  return { ok: true, data: { reviews: rows.map(serializeGuestReview), total } }
}

/** 该通告已通过游客评测的评分分布（供前端合并评分条） */
export function guestReviewDistribution(db: DB, dealId: string): Record<number, number> {
  // 软删除三列是本模块运行时补的，任何引用它们的 SQL 之前都必须先确保列存在
  ensureGuestReviewSchema(db)
  const rows = db.prepare(`
    SELECT rating, COUNT(*) AS count FROM token_deal_guest_reviews
    WHERE deal_id = ? AND status = 'approved' AND deleted_at IS NULL GROUP BY rating
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

  // 软删除三列是本模块运行时补的，任何引用它们的 SQL 之前都必须先确保列存在
  ensureGuestReviewSchema(db)
  const limit = Math.min(100, Math.max(1, parseInt(query?.limit as string) || 50))
  const page = Math.max(1, parseInt(query?.page as string) || 1)
  const offset = (page - 1) * limit

  const where = [
    "g.status = 'pending'",
    'g.deleted_at IS NULL',
    '(g.user_id IS NULL OR g.user_id != d.user_id)',
    'd.deleted_at IS NULL',
  ]
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
  // 软删除三列是本模块运行时补的，任何引用它们的 SQL 之前都必须先确保列存在
  ensureGuestReviewSchema(db)
  const viewer = normalizeViewerLocal(rawViewer)
  if (!viewer) return 0
  const where = [
    "g.status = 'pending'",
    'g.deleted_at IS NULL',
    '(g.user_id IS NULL OR g.user_id != d.user_id)',
    'd.deleted_at IS NULL',
  ]
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
  // 软删除三列是本模块运行时补的，任何引用它们的 SQL 之前都必须先确保列存在
  ensureGuestReviewSchema(db)
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
  // 被管理员删除的评测对外一律「不存在」—— 不能靠知道 id 继续审核一条已删除的记录
  if (row.deleted_at) return { ok: false, status: 404, error: '评测不存在' }

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

    // 驳回后该评测不再公开 → 其上的打标必须一并清掉。
    // 否则「先通过攒标、再驳回」会让计数残留在不可见的评测上；
    // 更实际的风险是同一 id 若被复用（撤回后重提会生成新 id，但驳回后旧行仍在），
    // 残留计数会被误读为有效社区反馈。
    if (action === 'reject') {
      db.prepare('DELETE FROM token_deal_review_marks WHERE review_id = ?').run(`g_${reviewId}`)
    }

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
  // 软删除三列是本模块运行时补的，任何引用它们的 SQL 之前都必须先确保列存在
  ensureGuestReviewSchema(db)
  const reviewId = String(rawReviewId ?? '').trim()
  if (!reviewId) return { ok: false, status: 400, error: '评测 ID 不能为空' }

  const row = db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(reviewId) as any
  if (!row) return { ok: false, status: 404, error: '评测不存在' }
  if (row.deleted_at) return { ok: false, status: 404, error: '评测不存在' }
  if (row.status !== 'pending') {
    return { ok: false, status: 409, error: '只能撤回待审核的评测' }
  }

  const viewer = optionalAuthLoose(event)
  const { fingerprint } = guestIdentity(event, viewer?.id ?? null)
  const isAdmin = !!viewer && isUserAdminLocal(db, viewer.id)
  if (row.fingerprint !== fingerprint && !isAdmin) {
    return { ok: false, status: 404, error: '评测不存在' }
  }

  db.transaction(() => {
    // 撤回的评测已不可见 → 其上的打标同步清理，避免计数停留在不存在的评测上
    db.prepare('DELETE FROM token_deal_review_marks WHERE review_id = ?').run(`g_${reviewId}`)
    db.prepare('DELETE FROM token_deal_guest_reviews WHERE id = ?').run(reviewId)
  })()
  return { ok: true, data: { id: reviewId } }
}

/** 详情端点用：当前访客在此通告上自己的待审评测 */
export function guestReviewSummary(db: DB, event: any, dealId: string) {
  // 软删除三列是本模块运行时补的，任何引用它们的 SQL 之前都必须先确保列存在
  ensureGuestReviewSchema(db)
  const viewer = optionalAuthLoose(event)
  const { fingerprint } = guestIdentity(event, viewer?.id ?? null)
  const row = db.prepare(`
    SELECT * FROM token_deal_guest_reviews
    WHERE deal_id = ? AND fingerprint = ? AND status = 'pending' AND deleted_at IS NULL
  `).get(dealId, fingerprint) as any
  return row ? serializeGuestReview(row) : null
}

// ─── 管理端：列表 / 处置 / 审计 ─────────────────────────────────

/** 管理端支持的筛选值（`all` 之外都是精确匹配，「已删」独立成一态） */
export const GUEST_REVIEW_ADMIN_STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'deleted'] as const
export type GuestReviewAdminStatusFilter = (typeof GUEST_REVIEW_ADMIN_STATUS_FILTERS)[number]

/** 状态筛选 → `deleted_at / status` 条件（SQL 片段与参数**成对**产出，避免拼错漏参数顺序） */
function statusFilterClause(filter: string): { sql: string; params: any[] } {
  if (filter === 'deleted') return { sql: 'g.deleted_at IS NOT NULL', params: [] }
  if (filter === 'pending' || filter === 'approved' || filter === 'rejected') {
    return { sql: 'g.deleted_at IS NULL AND g.status = ?', params: [filter] }
  }
  return { sql: '', params: [] } // all
}

/** 各状态计数（Tab 徽章）—— 带上关键字/通告筛选，徽章与列表内容才一致 */
function guestReviewStatusCounts(db: DB, extraSql: string, extraParams: any[]) {
  const out: Record<string, number> = {}
  for (const filter of GUEST_REVIEW_ADMIN_STATUS_FILTERS) {
    const { sql, params } = statusFilterClause(filter)
    const where = ['1 = 1']
    if (extraSql) where.push(extraSql)
    if (sql) where.push(sql)
    try {
      out[filter] = (db.prepare(
        'SELECT COUNT(*) AS c FROM token_deal_guest_reviews g WHERE ' + where.join(' AND ')
      ).get(...extraParams, ...params) as { c: number }).c
    } catch {
      out[filter] = 0
    }
  }
  return out
}

/**
 * 管理端：列出**全部**游客评测（四态可筛，可按通告/关键字过滤，分页）。
 *
 * 与公开 `listGuestReviews()` 的区别：这里含 pending / rejected / deleted，
 * 并带所属通告信息（管理端要能点进详情）。游客敏感字段一律经
 * `serializeGuestReviewForAdmin()` 白名单输出。
 */
export function listGuestReviewsForAdmin(
  db: DB,
  query: any,
): EditOpResult<{
  reviews: any[]
  total: number
  page: number
  limit: number
  counts: Record<string, number>
  scope: 'all'
}> {
  ensureGuestReviewSchema(db)

  const page = Math.max(1, parseInt(query?.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query?.limit as string) || 20))
  const offset = (page - 1) * limit

  // 状态：优先 status，其次 state（前端两种命名都认，避免前后端参数名漂移）
  const rawStatus = String(query?.status ?? query?.state ?? 'all').trim()
  const status = (GUEST_REVIEW_ADMIN_STATUS_FILTERS as readonly string[]).includes(rawStatus) ? rawStatus : 'all'

  const dealId = String(query?.deal_id ?? query?.deal ?? '').trim()
  const keyword = String(query?.keyword ?? query?.q ?? '').trim()

  const filterSql: string[] = []
  const filterParams: any[] = []
  if (dealId) {
    filterSql.push('g.deal_id = ?')
    filterParams.push(dealId)
  }
  if (keyword) {
    const like = `%${escapeLike(keyword)}%`
    filterSql.push(
      "(g.content LIKE ? ESCAPE '\\' OR g.nickname LIKE ? ESCAPE '\\'"
      + " OR g.deal_id LIKE ? ESCAPE '\\' OR g.id LIKE ? ESCAPE '\\')"
    )
    filterParams.push(like, like, like, like)
  }
  const extraSql = filterSql.join(' AND ')
  const { sql: stateSql, params: stateParams } = statusFilterClause(status)

  const where = ['1 = 1']
  if (extraSql) where.push(extraSql)
  if (stateSql) where.push(stateSql)
  const whereSql = where.join(' AND ')

  // 当前筛选下的条数（`total`）与各状态计数（Tab 徽章）
  // —— 计数**同样受通告/关键字筛选影响**，这样徽章数字与点进去看到的列表永远一致，
  //    不会出现「徽章写 3、列表只 1 条」的迷惑
  const total = (db.prepare(
    'SELECT COUNT(*) AS c FROM token_deal_guest_reviews g WHERE ' + whereSql
  ).get(...filterParams, ...stateParams) as { c: number }).c
  const counts = guestReviewStatusCounts(db, extraSql, filterParams)

  const rows = db.prepare(`
    SELECT g.*, d.provider AS deal_provider, d.title AS deal_title,
           d.status AS deal_status, d.deleted_at AS deal_deleted_at
    FROM token_deal_guest_reviews g
    LEFT JOIN token_deals d ON d.id = g.deal_id
    WHERE ${whereSql}
    ORDER BY g.updated_at DESC, g.created_at DESC, g.id DESC
    LIMIT ? OFFSET ?
  `).all(...filterParams, ...stateParams, limit, offset) as any[]

  return {
    ok: true,
    data: {
      reviews: rows.map((r) => {
        const view = serializeGuestReviewForAdmin(r) as Record<string, any>
        view.deal = {
          id: r.deal_id,
          provider: r.deal_provider ?? null,
          title: r.deal_title ?? null,
          status: r.deal_status ?? null,
          /** 通告本身是否已软删除（管理端列表要能区分「通告没了」和「评测没了」） */
          deleted: !!r.deal_deleted_at,
        }
        return view
      }),
      total,
      page,
      limit,
      counts,
      scope: 'all',
    },
  }
}

/**
 * 管理端：最近处置记录（跨评测，倒序）。
 *
 * `?stat=1` 时顺带做一次软删除态收敛（历史遗留的「已删但 status 仍是 approved」行），
 * 返回值里 `auto_refresh=true` 表示收敛时改过行，前端应重新拉列表 —— 避免前台删了、
 * 界面还停在旧计数上。
 */
export function listGuestReviewAdminActions(
  db: DB,
  query: any,
): EditOpResult<{ actions: any[]; auto_refresh: boolean }> {
  ensureGuestReviewSchema(db)

  const limit = Math.min(100, Math.max(1, parseInt(query?.limit as string) || 20))
  const reviewId = String(query?.review_id ?? '').trim()
  const wantSync = String(query?.stat ?? '') === '1'

  let refreshed = 0
  if (wantSync) {
    try {
      refreshed = db.prepare(
        "UPDATE token_deal_guest_reviews SET status = 'rejected', updated_at = ?"
        + ' WHERE deleted_at IS NOT NULL AND status = \'approved\''
      ).run(Date.now()).changes
    } catch { /* 收敛失败不影响审计读取 */ }
  }

  let rows: any[] = []
  try {
    rows = (reviewId
      ? db.prepare(
        'SELECT * FROM guest_review_admin_actions WHERE review_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      ).all(reviewId, limit)
      : db.prepare(
        'SELECT * FROM guest_review_admin_actions ORDER BY created_at DESC, id DESC LIMIT ?',
      ).all(limit)) as any[]
  } catch { /* 表缺失（未迁移）时按空处理 */ }

  return {
    ok: true,
    data: { actions: rows.map(serializeGuestReviewAdminAction), auto_refresh: refreshed > 0 },
  }
}

/** 写一条处置审计（best-effort：审计失败绝不回滚主操作） */
function appendGuestReviewAdminAction(
  db: DB,
  actor: { id: number; username: string },
  row: { id: string; deal_id: string },
  action: GuestReviewAdminAction,
  fromStatus: string,
  toStatus: string,
  reason: string,
  now: number,
): void {
  try {
    db.prepare(`
      INSERT INTO guest_review_admin_actions
        (review_id, deal_id, action, from_status, to_status, reason, actor_id, actor_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.deal_id, action, fromStatus, toStatus, reason, actor.id, actor.username, now)
  } catch (err: any) {
    console.warn('[GuestReview] 处置审计落库失败（不影响主操作）:', err?.message || err)
  }
  // 同时打一行服务端日志：容器日志是最后一道追溯手段，成本极低
  // （理由来自请求体，去掉换行避免伪造日志行 / 日志注入）
  const safeReason = reason.replace(/[\r\n]+/g, ' ')
  console.log(
    `[Admin][GuestReview] ${action} review=${row.id} deal=${row.deal_id}`
    + ` by=${actor.username}(${actor.id}) ${fromStatus}→${toStatus}`
    + (safeReason ? ` reason=${safeReason}` : ''),
  )
}

/** 处置后的提示文案（按动作 + 删除前的状态给不同说法，避免「已删除」被说成「已驳回」） */
function guestReviewActionMessage(action: GuestReviewAdminAction, beforeStatus: string): string {
  if (action === 'delete') {
    return beforeStatus === 'approved'
      ? '已删除该评测，同时从公开列表移除并重算通告评分'
      : '已删除该评测'
  }
  if (action === 'restore') return '已恢复该评测'
  if (action === 'approve') return '已通过，该评测已公开并计入评分'
  return '已驳回该评测'
}

/**
 * 管理端处置游客评测 —— **唯一写入口**（approve / reject / delete / restore）。
 *
 * ## 为什么没把删除塞进既有的 `withdrawGuestReview()`
 *
 * 那个函数是「游客撤回自己的待审评测」：身份靠指纹（游客没有账号）、只允许 pending、
 * 而且是**物理删除**。管理端要的是「由管理员处置任意状态的评测 + 软删除 + 留痕」，
 * 鉴权口径（requireAdmin）与语义都不同 —— 混在一处必然写出「谁都能删已通过评测」的漏洞。
 * 因此另立本函数；公共逻辑（状态机、计数重算、打标清理）仍复用同一套。
 *
 * ## 三个不变量
 *
 *   1. 删除是**软删除**：只写 `deleted_at / deleted_by / deleted_status`，行永不出库，
 *      且 `status` 同时降级为 `rejected`（见 `GUEST_REVIEW_DELETED_REASON` 的说明）。
 *   2. 任何状态变化后**必须重算主表计数**：评分只认 approved，状态一动计数就要跟。
 *   3. 每个动作都写审计，且审计失败不回滚主操作（审计是附加产物）。
 */
export function adminActOnGuestReview(
  db: DB,
  actor: { id: number; username: string },
  rawReviewId: unknown,
  body: any,
): EditOpResult<{ review: any; action: GuestReviewAdminAction; message: string }> {
  ensureGuestReviewSchema(db)

  const reviewId = String(rawReviewId ?? '').trim()
  if (!reviewId) return { ok: false, status: 400, error: '评测 ID 不能为空' }

  const action = String(body?.action ?? '').trim() as GuestReviewAdminAction
  if (!(GUEST_REVIEW_ADMIN_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, status: 400, error: '处置动作必须是 approve / reject / delete / restore' }
  }

  const row = db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(reviewId) as any
  if (!row) return { ok: false, status: 404, error: '评测不存在' }

  const reason = String(body?.reason ?? '').trim().slice(0, 200)
  const now = Date.now()
  const beforeStatus = String(row.status || '')
  const isDeleted = !!row.deleted_at

  // 幂等与冲突：同类动作重复执行不报错（前端连点/重试要安全），矛盾动作明确 409
  if (action === 'delete') {
    if (isDeleted) {
      return {
        ok: true,
        data: {
          review: serializeGuestReviewForAdmin(row),
          action,
          message: '该评测此前已被删除',
        },
      }
    }
  }

  if (action === 'restore') {
    if (!isDeleted) {
      return {
        ok: true,
        data: {
          review: serializeGuestReviewForAdmin(row),
          action,
          message: '该评测未被删除，无需恢复',
        },
      }
    }
  }

  // 删除是定论：已删除的评测不能再被「通过 / 驳回」，必须先恢复（否则状态机可以在
  // deleted 上继续流转，审计里的 deleted_at 就失去意义）
  if (isDeleted && (action === 'approve' || action === 'reject')) {
    return { ok: false, status: 409, error: '该评测已被删除，如需重新处置请先恢复' }
  }

  let countDealId = ''
  db.transaction(() => {
    if (action === 'delete') {
      // 记录删除前的审核状态 → 恢复时还原（而不是一律回到 pending）
      db.prepare(`
        UPDATE token_deal_guest_reviews
        SET deleted_at = ?, deleted_by = ?, deleted_status = ?,
            status = 'rejected', reject_reason = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(
        now,
        actor.id,
        beforeStatus,
        GUEST_REVIEW_DELETED_REASON + (reason ? ` ${reason}` : ''),
        now,
        reviewId,
      )
      countDealId = row.deal_id
    } else if (action === 'restore') {
      const restoredStatus = (GUEST_REVIEW_STATUSES as readonly string[]).includes(String(row.deleted_status || ''))
        ? String(row.deleted_status)
        : 'pending'
      db.prepare(`
        UPDATE token_deal_guest_reviews
        SET deleted_at = NULL, deleted_by = NULL, deleted_status = '',
            status = ?, reject_reason = '', updated_at = ?
        WHERE id = ? AND deleted_at IS NOT NULL
      `).run(restoredStatus, now, reviewId)
      countDealId = row.deal_id
    } else if (action === 'approve') {
      if (beforeStatus !== 'pending') {
        throw createError({
          statusCode: 409,
          data: { error: `该评测已${beforeStatus === 'approved' ? '通过' : '驳回'}，无需重复审核` },
        })
      }
      db.prepare(`
        UPDATE token_deal_guest_reviews
        SET status = 'approved', reject_reason = '', reviewer_id = ?, updated_at = ?
        WHERE id = ?
      `).run(actor.id, now, reviewId)
      countDealId = row.deal_id
    } else {
      if (beforeStatus !== 'pending') {
        throw createError({
          statusCode: 409,
          data: { error: `该评测已${beforeStatus === 'approved' ? '通过' : '驳回'}，无需重复审核` },
        })
      }
      db.prepare(`
        UPDATE token_deal_guest_reviews
        SET status = 'rejected', reject_reason = ?, reviewer_id = ?, updated_at = ?
        WHERE id = ?
      `).run(reason, actor.id, now, reviewId)
      countDealId = row.deal_id
      // 驳回后不再公开 → 其上的打标必须一并清掉（与 reviewGuestReview 同口径）
      try {
        db.prepare('DELETE FROM token_deal_review_marks WHERE review_id = ?').run(`g_${reviewId}`)
      } catch { /* 打标表未迁移时忽略 */ }
    }

    if (countDealId) syncDealCounters(db, countDealId)

    const updated = db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(reviewId) as any
    appendGuestReviewAdminAction(
      db,
      actor,
      row,
      action,
      beforeStatus,
      String(updated?.status || ''),
      reason,
      now,
    )
  })()

  const updated = db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(reviewId) as any
  return {
    ok: true,
    data: {
      review: serializeGuestReviewForAdmin(updated),
      action,
      message: guestReviewActionMessage(action, beforeStatus),
    },
  }
}

// ─── 局部依赖 ───────────────────────────────────────────────────

/** 容错的 optionalAuth —— 事件对象异常时视为未登录，不阻断游客流程 */
export function optionalAuthLoose(event: any): { id: number } | null {
  try {
    const u = optionalAuth(event)
    return u ? { id: u.id } : null
  } catch {
    return null
  }
}
