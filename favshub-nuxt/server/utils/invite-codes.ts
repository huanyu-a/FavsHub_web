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

  // 极端权重会让抽选分布失真，要判**两种**退化：
  //   1. 多个 Number.MAX_VALUE 相加 → total 为 Infinity，`rand() * total` 恒为 Infinity；
  //   2. **有限但极大**（更隐蔽）：`MAX_VALUE + 2 === MAX_VALUE`（浮点），
  //      于是 total 看起来正常，实际抽选几乎全落在那个巨权重上、其余码被饿死。
  // 所以判据不能只看 isFinite，还要落在可精确表示的整数范围内。
  // 检出退化为等概率：宁可与配置不符，也不要给出错误的分布（接口层权重已夹到 [1,1000]，
  // 这里是纵深防御，防的是直接改库或将来新增的写入路径）。
  const sane = Number.isFinite(total) && total > 0 && total <= Number.MAX_SAFE_INTEGER
  const effective = sane ? weights : pool.map(() => 1)
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
  // 必须按**字节**长度判，不能用 `t.length`：后者数的是 UTF-16 码元，
  // 32 个汉字是 32 码元却有 96 字节 —— 长度检查放行后 `timingSafeEqual` 会因字节长度不等
  // 抛 RangeError，未认证即可把接口打成 500（契约应是 400/拒绝）。
  // `utils/ai-auth.ts` 与 `onebot.post.ts` 在别处就是这么比的，这里之前漏了。
  const got = Buffer.from(String(token ?? ''), 'utf8')
  if (got.length !== 32) return false
  const bucket = Math.floor(now / DRAW_TOKEN_TTL_MS)
  for (const b of [bucket, bucket - 1]) {
    const expect = Buffer.from(drawTokenFor(dealId, codeId, b), 'utf8')
    // 定长比较用 timingSafeEqual，避免按字节提前返回泄露信息（长度已确认相等）
    if (expect.length === got.length && timingSafeEqual(expect, got)) return true
  }
  return false
}

// ════════════════════════════════════════════════════════════════
// 领取地址里的邀请码占位符（2026-10-30）
//
// 需求：领取地址里可以写 `{邀请码}`，例如
//   https://platform.lyrouter.com/ai_gateway/workspace/login?action=register&referral_code={邀请码}&share_v=2
// 用户抽中码时，服务端把占位符替换成**本次抽中的那个码**，返回完整地址。
//
// 三条硬约束（改这里之前先读完）：
//
//   1. **替换只发生在「已抽中该码」的响应里**（`GET /:id/invite-code` 的 `claim_url`）。
//      通告详情 / 列表 / feed / AI 通道一律只给原文模板，**绝不出现任何码**，也不出现半替换的串：
//      码池不进详情是本仓的安全不变量（一旦进详情，前端「按比例只出现一个」就是障眼法）。
//      未抽中时 `resolveClaimUrl` 的调用方必须落 `claim_url: ''`，而不是把空值填进模板。
//
//   2. 替换值**一律 `encodeURIComponent`**。占位符几乎总落在 query 里
//      （`?referral_code={邀请码}&share_v=2`），不编码的话码里的 `&` / `#` / `=` / 空格
//      会直接截断或改写整个 URL。路径位置同样按路径段编码，结果一致 ——
//      这里**刻意不做「按位置分支编码」**：多一条分支就多一次「某条忘了编码」的机会。
//
//   3. 替换逻辑**只此一处**（纯函数）。端点里不许再 `replace` 一遍 ——
//      多写一遍就迟早出现「某条路径漏了编码」。
// ════════════════════════════════════════════════════════════════

/**
 * 兼容写法：`{邀请码}` / `{code}` / `{invite_code}`，**半角与全角花括号都认**。
 *
 * 全角是为中文输入法准备的 —— 实测「｛邀请码｝」是很容易踩的输入结果，
 * 而它对用户来说与半角完全一样，没有理由因此让功能不生效。
 */
export const CLAIM_CODE_PLACEHOLDERS = ['{邀请码}', '{code}', '{invite_code}'] as const

/** 半角/全角花括号 + 三种占位符名（共享的真源，两个正则都由它派生，避免两处漂移） */
const CLAIM_PLACEHOLDER_PATTERN = '[｛{](?:邀请码|code|invite_code)[｝}]'
/** 全局替换用（`String.replace` 对 `/g` 正则会自行重置 lastIndex，可安全复用） */
const CLAIM_PLACEHOLDER_RE = new RegExp(CLAIM_PLACEHOLDER_PATTERN, 'g')
/** 仅判定用（非全局，避免 `test()` 的 lastIndex 状态污染 —— `/g` + `test` 是有名的坑） */
const CLAIM_PLACEHOLDER_TEST_RE = new RegExp(CLAIM_PLACEHOLDER_PATTERN)

/**
 * 取通告的「领取地址」及其来源字段。
 *
 * 选序（从需求口径出发，并补掉一个会让功能形同虚设的坑）：
 *   1. `call_url` 里写了占位符 → 用它；
 *   2. `url` 里写了占位符 → 用它；
 *   3. 都没写占位符 → `call_url` 非空则用它，否则 `url`（即需求里的「call_url，若为空则 url」）。
 *
 * 为什么第 2 步要插在「call_url 优先」之前：最常见的填法是
 * `url` = 带 `{邀请码}` 的注册/领取页、`call_url` = API 基址（拉模型用）。
 * 若死守「call_url 优先」，这类通告抽码后拿到的 `claim_url` 会是 API 基址、
 * 占位符被静默忽略 —— 用户以为写对了，功能却静默不生效。
 * `claim_url_source` 会如实告诉前端这次用的是哪个字段，行为对前端是透明的。
 */
export function claimUrlTemplateOf(
  deal: { call_url?: unknown; url?: unknown } | null | undefined,
): { source: 'call_url' | 'url'; template: string } {
  const callUrl = String(deal?.call_url ?? '').trim()
  const url = String(deal?.url ?? '').trim()
  if (hasClaimCodePlaceholder(callUrl)) return { source: 'call_url', template: callUrl }
  if (hasClaimCodePlaceholder(url)) return { source: 'url', template: url }
  if (callUrl) return { source: 'call_url', template: callUrl }
  return { source: 'url', template: url }
}

/** 领取地址模板里是否写了邀请码占位符（详情页据此提示「需先抽码」，不必暴露码池） */
export function hasClaimCodePlaceholder(template: unknown): boolean {
  const t = String(template ?? '')
  if (!t) return false
  return CLAIM_PLACEHOLDER_TEST_RE.test(t)
}

/**
 * 把模板里的占位符替换成本次抽中的码。
 *
 * - 没有码（码池空 / 调用方未传）→ 返回 `''`：**绝不用空串替换出一个残缺 URL**，
 *   调用方据此区分「抽到了」与「没抽到」；
 * - 模板里没有占位符 → 原样返回（领取地址就是模板本身，前端可以直接拿它当链接用）。
 *
 * 替换值走 `encodeURIComponent`；用**函数式替换**而不是字符串替换，是因为
 * `String.replace` 的字符串参数会把 `$&` / `$'` / `$1` 当特殊记号 ——
 * 码里真出现 `$&` 就会被替换成别的内容（实测会注入匹配到的占位符本身）。函数式替换没有这个坑。
 */
export function resolveClaimUrl(template: unknown, code: unknown): string {
  const t = String(template ?? '')
  const c = String(code ?? '')
  if (!t || !c) return ''
  const encoded = encodeURIComponent(c)
  return t.replace(CLAIM_PLACEHOLDER_RE, () => encoded)
}

