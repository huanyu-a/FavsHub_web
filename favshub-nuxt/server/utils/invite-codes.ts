/**
 * 通告邀请码池（2026-10-30）
 *
 * 产品语义：**一个通告可配置多个邀请码**，每个码有
 *   - `weight`     展现比例：按权重加权随机，权重越大越容易被抽中
 *   - `copyLimit`  被复制次数上限：`copy_count` 达到后该码**不再出现**（0 = 不限）
 * 用户访问详情页时，服务端只下发**被抽中的那一个**。
 *
 * ── 为什么码池不随详情接口下发 ────────────────────────────────
 * 若把 `invite_codes` 数组塞进 `/api/token-deals/:id`，前端「按比例只显示一个」
 * 就纯属摆设：任何人按 F12 都能看到全部码，比例与阈值形同虚设。
 * 因此公开侧只有 `GET /:id/invite-code`（返回抽中的单个码）与
 * `POST /:id/invite-code/:codeId/copy`（计数）两个端点，
 * 完整码池只在「作者 / 管理员」的 `GET /:id/invite-codes` 里出现。
 */
import type Database from 'better-sqlite3'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSecret } from './jwt'

/** 码池字段上限 —— 与前端 `TokenDealEditor` 的常量保持一致 */
export const INVITE_CODE_LIMITS = {
  /** 单个通告最多几个码（防止一次提交几百个码把详情页撑爆） */
  maxPerDeal: 20,
  /** 单个码最大长度（邀请链接可能很长） */
  code: 300,
  /** 展示备注最大长度 */
  label: 40,
  /** 权重上限（避免有人填 999999 把其它码饿死） */
  maxWeight: 1000,
  /** 复制次数上限的封顶 */
  maxCopyLimit: 1_000_000,
} as const

/** 前端提交的单个码（已归一化） */
export interface InviteCodeInput {
  code: string
  label: string
  weight: number
  copyLimit: number
  enabled: boolean
}

/** 数据库行 */
export interface InviteCodeRow {
  id: number
  deal_id: string
  code: string
  label: string
  weight: number
  copy_limit: number
  copy_count: number
  enabled: number
  sort_order: number
  created_at: number
  updated_at: number
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/**
 * 校验并归一化前端提交的码池。
 *
 * 采用**全量替换**语义：提交的数组就是最终码池，未出现的码会被删除。
 * `null` / `undefined` 视为空池（清空）。
 */
/**
 * 是否被**显式**停用（表单/JSON 客户端可能传 `false`、`0`、`'false'`、`'0'`）。
 * 缺省与其它任何值都视为启用 —— 与「只有明确说了才停用」的语义一致。
 */
function isExplicitlyDisabled(v: unknown): boolean {
  if (v === false || v === 0) return true
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'false' || s === '0'
  }
  return false
}

export function validateInviteCodes(
  input: unknown,
): { ok: true; codes: InviteCodeInput[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, codes: [] }
  if (!Array.isArray(input)) return { ok: false, error: '邀请码必须是数组' }
  if (input.length > INVITE_CODE_LIMITS.maxPerDeal) {
    return { ok: false, error: `单个通告最多 ${INVITE_CODE_LIMITS.maxPerDeal} 个邀请码` }
  }

  const codes: InviteCodeInput[] = []
  const seen = new Set<string>()

  for (let i = 0; i < input.length; i++) {
    const raw = input[i]
    const at = `第 ${i + 1} 个邀请码`
    if (!raw || typeof raw !== 'object') return { ok: false, error: `${at}格式不正确` }

    const code = String((raw as any).code ?? '').trim()
    if (!code) return { ok: false, error: `${at}内容为空` }
    if (code.length > INVITE_CODE_LIMITS.code) {
      return { ok: false, error: `${at}超过 ${INVITE_CODE_LIMITS.code} 字` }
    }
    if (seen.has(code)) return { ok: false, error: `邀请码「${code}」重复` }
    seen.add(code)

    codes.push({
      code,
      label: String((raw as any).label ?? '').trim().slice(0, INVITE_CODE_LIMITS.label),
      // weight <= 0 会被 pickInviteCode 兜底成 1，这里直接夹到 [1, maxWeight]
      weight: clampInt((raw as any).weight, 1, 1, INVITE_CODE_LIMITS.maxWeight),
      copyLimit: clampInt((raw as any).copyLimit, 0, 0, INVITE_CODE_LIMITS.maxCopyLimit),
      // 只有**显式**停用才停用：布尔 false、数字 0，以及表单序列化出来的 'false' / '0'。
      // 2026-10-30 审查指出原先只认字面 false/0，`enabled:'false'` 会被当成启用 ——
      // 表单/JSON 客户端很容易传字符串，那种「以为停用了其实没停」的坑不值得留。
      enabled: !isExplicitlyDisabled((raw as any).enabled),
    })
  }

  return { ok: true, codes }
}

/**
 * 全量替换某通告的码池（单事务）。
 *
 * **保留 `copy_count`**：按码内容匹配已有记录沿用计数。
 * 否则每次编辑通告（哪怕只改标题）都会把复制计数清零，已经「用满」的码会重新开始出现
 * —— 正是需求要避免的行为。码内容被改写则视为新码，计数从 0 起算。
 *
 * 匹配是**大小写敏感的精确匹配**（`===`，不 trim 不归一化）：
 * 把 `KEEP` 改成 `keep` 会被当作新码、计数归零。这是刻意的 ——
 * 「改了内容就重新计数」让运营可以主动用改码来重置额度；
 * 代价是「改个大小写就把用满的码复活」，若哪天认为不可接受，
 * 就在这里改成 `code.toLowerCase()` 建索引。
 */
export function replaceInviteCodes(
  db: Database.Database,
  dealId: string,
  codes: InviteCodeInput[],
): void {
  const now = Date.now()

  db.transaction(() => {
    const prevRows = db.prepare(
      'SELECT code, copy_count FROM token_deal_invite_codes WHERE deal_id = ?'
    ).all(dealId) as Array<{ code: string; copy_count: number }>
    const prevCount = new Map(prevRows.map(r => [r.code, Number(r.copy_count) || 0]))

    db.prepare('DELETE FROM token_deal_invite_codes WHERE deal_id = ?').run(dealId)

    const insert = db.prepare(`
      INSERT INTO token_deal_invite_codes
        (deal_id, code, label, weight, copy_limit, copy_count, enabled, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    codes.forEach((c, idx) => {
      insert.run(
        dealId, c.code, c.label, c.weight, c.copyLimit,
        prevCount.get(c.code) ?? 0,
        c.enabled ? 1 : 0,
        idx,
        now, now,
      )
    })
  })()
}

/** 读取某通告的完整码池（仅作者 / 管理员端点使用） */
export function listInviteCodes(db: Database.Database, dealId: string): InviteCodeRow[] {
  return db.prepare(`
    SELECT * FROM token_deal_invite_codes
    WHERE deal_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(dealId) as InviteCodeRow[]
}

/**
 * 配置码池的权限闸门：**仅通告作者或管理员**。
 *
 * 已删除的通告一律 404（恢复是管理员动作），其余非作者返回 403 —— 
 * 与 `findWritableDeal` 的「不可见即 404」不同：这里的信息（有哪些码）
 * 连存在性都不该告诉非作者，所以先用 404 挡「不存在/已删」，再用 403 挡越权。
 */
export function findManageableDeal(
  db: Database.Database,
  dealId: string,
  viewer: { id: number; isAdmin: boolean },
): { ok: true; deal: Record<string, any> } | { ok: false; status: number; error: string } {
  const deal = db.prepare(
    'SELECT id, user_id, title, deleted_at FROM token_deals WHERE id = ?'
  ).get(dealId) as Record<string, any> | undefined

  if (!deal || deal.deleted_at) {
    return { ok: false, status: 404, error: '通告不存在' }
  }
  if (!viewer.isAdmin && deal.user_id !== viewer.id) {
    return { ok: false, status: 403, error: '只有通告作者或管理员可以配置邀请码' }
  }
  return { ok: true, deal }
}

/** 可抽取条件：启用 且 未达复制上限 */
const AVAILABLE_CLAUSE = 'enabled = 1 AND (copy_limit = 0 OR copy_count < copy_limit)'

/** 是否还有可下发的码（详情页据此决定要不要渲染邀请码区块，不必暴露码池） */
export function hasAvailableInviteCode(db: Database.Database, dealId: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM token_deal_invite_codes
    WHERE deal_id = ? AND ${AVAILABLE_CLAUSE}
    LIMIT 1
  `).get(dealId)
  return !!row
}

/** 可用码数量（后台展示「剩余 x/y」用） */
export function countInviteCodes(
  db: Database.Database,
  dealId: string,
): { total: number; available: number } {
  const total = (db.prepare(
    'SELECT COUNT(*) AS c FROM token_deal_invite_codes WHERE deal_id = ?'
  ).get(dealId) as { c: number }).c
  const available = (db.prepare(
    `SELECT COUNT(*) AS c FROM token_deal_invite_codes WHERE deal_id = ? AND ${AVAILABLE_CLAUSE}`
  ).get(dealId) as { c: number }).c
  return { total, available }
}

/**
 * 按 `weight` 加权随机抽一个可用码。
 *
 * `rand` 可注入（默认 `Math.random`），便于测试验证分布与边界。
 * 池为空（全部用满 / 全部停用）返回 `null` —— 调用方据此返回「暂无邀请码」。
 */
export function pickInviteCode(
  db: Database.Database,
  dealId: string,
  rand: () => number = Math.random,
): InviteCodeRow | null {
  const pool = db.prepare(`
    SELECT * FROM token_deal_invite_codes
    WHERE deal_id = ? AND ${AVAILABLE_CLAUSE}
    ORDER BY sort_order ASC, id ASC
  `).all(dealId) as InviteCodeRow[]

  if (!pool.length) return null

  // weight <= 0 或非法一律兜底为 1，保证「每个可用码至少有机会」
  const weights = pool.map(r => {
    const w = Number(r.weight)
    return Number.isFinite(w) && w > 0 ? w : 1
  })
  const total = weights.reduce((a, b) => a + b, 0)

  // 极端权重叠加（如多个 Number.MAX_VALUE）会让 total 变 Infinity，
  // 那样 `rand() * total` 恒为 Infinity，差值永远不减到 0 以下 → 永远返回最后一个码、
  // 其余码被彻底饿死。检出这种退化情形就改用等概率，宁可与配置不符也不要给出错误的分布。
  const effective = Number.isFinite(total) && total > 0 ? weights : pool.map(() => 1)
  const safeTotal = effective.reduce((a, b) => a + b, 0)

  let t = rand() * safeTotal
  for (let i = 0; i < pool.length; i++) {
    t -= effective[i]
    if (t < 0) return pool[i]
  }
  // 浮点边界兜底（rand() 趋近 1 时可能落空）
  return pool[pool.length - 1]
}

/**
 * 记一次复制。
 *
 * **原子的条件自增**：`WHERE ... copy_count < copy_limit` 把「检查」和「自增」压进
 * 同一条 UPDATE，避免并发下超发（先查后写会竞态）。
 * 返回 `ok:false` 表示该码已用满或已停用 —— 计数不再上涨。
 */
export function recordInviteCodeCopy(
  db: Database.Database,
  dealId: string,
  codeId: number,
): { ok: boolean; reason?: string } {
  const res = db.prepare(`
    UPDATE token_deal_invite_codes
    SET copy_count = copy_count + 1, updated_at = ?
    WHERE id = ? AND deal_id = ? AND ${AVAILABLE_CLAUSE}
  `).run(Date.now(), codeId, dealId)

  if (res.changes === 0) return { ok: false, reason: 'not_available' }
  return { ok: true }
}

// ── 抽中凭证（2026-10-30 审查后补）────────────────────────────────────────
//
// 仅限频挡不住「枚举 codeId 烧别人配额」：copy 端点原先只校验「码属于该通告」，
// 于是任何人 POST 一堆 codeId 就能把 copy_limit 逐个烧满，把码从池里挤出去。
// 因此抽码时下发一个短时凭证，copy 时必须带上它 —— 证明「你确实刚被发过这个码」。
//
// 凭证是 HMAC（密钥派生自 JWT secret，与 `utils/avatar.ts` 同一套做法，不新增密钥管理面），
// 按 10 分钟分档，校验时接受**当前档与上一档** → 实际有效期 10~20 分钟，足够用户从容复制。

/** 凭证分档窗口 */
const DRAW_TOKEN_TTL_MS = 10 * 60 * 1000

function drawTokenFor(dealId: string, codeId: number, bucket: number): string {
  return createHmac('sha256', getSecret())
    .update(`favshub:invite-draw:${dealId}:${codeId}:${bucket}`)
    .digest('hex')
    .slice(0, 32)
}

/** 为「刚刚抽中的这个码」签发凭证 */
export function signDrawToken(dealId: string, codeId: number, now = Date.now()): string {
  return drawTokenFor(dealId, codeId, Math.floor(now / DRAW_TOKEN_TTL_MS))
}

/** 校验凭证是否对得上该 (通告, 码) 组合 */
export function verifyDrawToken(
  dealId: string,
  codeId: number,
  token: unknown,
  now = Date.now(),
): boolean {
  const t = String(token ?? '')
  if (t.length !== 32) return false
  const bucket = Math.floor(now / DRAW_TOKEN_TTL_MS)
  for (const b of [bucket, bucket - 1]) {
    const expect = drawTokenFor(dealId, codeId, b)
    // 定长比较用 timingSafeEqual，避免按字节提前返回泄露信息
    if (timingSafeEqual(Buffer.from(expect), Buffer.from(t))) return true
  }
  return false
}
