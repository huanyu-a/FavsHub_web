/**
 * AI 数据操作能力 — PAT（个人访问令牌）鉴权、权限校验、限频与审计
 *
 * 通道隔离铁律：
 *   - 本模块**只接受** `Authorization: Bearer favs_ai_...` 形式的 PAT，
 *     绝不回退到 JWT 校验 —— 否则用户 JWT 就能越道访问 `/api/ai/*`。
 *   - 反向由 `server/utils/auth.ts` 的 `verifyToken()` 保证：
 *     PAT 不是合法 JWT，必然校验失败 → 401。两条通道物理隔离。
 *
 * 安全设计：
 *   - 明文令牌只在创建响应中出现一次；库中仅存 SHA-256 hex（`token_hash`）。
 *   - `delete` 权限必须显式授予，且仅管理员可创建含该权限的令牌（在创建端点校验）。
 *   - 所有请求先过 IP 级兜底限频（防无效令牌暴力猜测），再过令牌级限频。
 *   - 审计在 finally 中落库，best-effort（失败不阻断业务）。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getHeader, getRequestURL, type H3Event } from 'h3'
import { getRawDb } from '../database'
import { checkRateLimit, getClientIP } from './rate-limit'

/** 令牌前缀 — 用于通道识别与展示 */
export const PAT_PREFIX = 'favs_ai_'

/** 单次批量写操作上限 */
export const AI_BATCH_LIMIT = 50

export type AiScope = 'read' | 'write' | 'delete'

/** scope 等级：数字越大权限越高，校验时取授予的最高等级比较 */
const SCOPE_RANK: Record<AiScope, number> = { read: 1, write: 2, delete: 3 }

export interface AiTokenRow {
  id: number
  user_id: number
  name: string
  token_hash: string
  token_prefix: string
  scopes: string
  created_at: number
  expires_at: number | null
  last_used_at: number | null
  revoked_at: number | null
}

// ─── 令牌生成与哈希 ─────────────────────────────────────────────

/** 生成明文令牌：`favs_ai_` + 32 字节 CSPRNG 的 base64url（43 字符，共 51 字符） */
export function generatePat(): string {
  return PAT_PREFIX + randomBytes(32).toString('base64url')
}

/** 计算落库哈希（SHA-256 hex，64 字符） */
export function hashPat(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

/**
 * 取展示用前缀 —— 随机段前 8 字符。
 * 注意：整串前 8 字符恒为 `favs_ai_`，无区分度，故取随机段。
 */
export function patPrefixOf(plain: string): string {
  return plain.slice(PAT_PREFIX.length, PAT_PREFIX.length + 8)
}

/** 展示格式化：`favs_ai_ab12cd34…` */
export function formatPatPrefix(prefix: string): string {
  return `${PAT_PREFIX}${prefix}…`
}

// ─── scope ─────────────────────────────────────────────────────

/** 归一化 scope 字符串为合法 scope 数组 */
export function parseScopes(raw: unknown): AiScope[] {
  if (Array.isArray(raw)) {
    return raw.map(String).map(s => s.trim().toLowerCase()).filter(isAiScope)
  }
  if (typeof raw === 'string') {
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(isAiScope)
  }
  return []
}

export function isAiScope(v: unknown): v is AiScope {
  return v === 'read' || v === 'write' || v === 'delete'
}

/** 序列化 scope 数组为存储格式（去重 + 按等级排序） */
export function serializeScopes(scopes: AiScope[]): string {
  return [...new Set(scopes)].sort((a, b) => SCOPE_RANK[a] - SCOPE_RANK[b]).join(',')
}

/** 判断令牌是否满足所需 scope（取授予的最高等级比较，delete 必须显式授予） */
export function hasScope(row: Pick<AiTokenRow, 'scopes'>, need: AiScope): boolean {
  const granted = parseScopes(row.scopes)
  if (granted.length === 0) return false
  const max = Math.max(...granted.map(g => SCOPE_RANK[g]))
  return max >= SCOPE_RANK[need]
}

// ─── 令牌校验 ───────────────────────────────────────────────────

/**
 * 校验明文令牌，返回有效令牌行（已过滤吊销 / 过期），无效返回 null。
 */
export function verifyPat(raw: string): AiTokenRow | null {
  if (typeof raw !== 'string' || !raw.startsWith(PAT_PREFIX)) return null

  const computed = hashPat(raw)
  const db = getRawDb()
  const row = db.prepare(
    `SELECT * FROM api_tokens
      WHERE token_hash = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)`
  ).get(computed, Date.now()) as AiTokenRow | undefined
  if (!row) return null

  // defense-in-depth：等值比对。timingSafeEqual 在长度不等时会抛 RangeError，
  // 必须先判长度（sha256 hex 恒为 64，此处为防御性写法）。
  const a = Buffer.from(computed, 'utf8')
  const b = Buffer.from(String(row.token_hash), 'utf8')
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null

  return row
}

// ─── 鉴权入口 ───────────────────────────────────────────────────

/**
 * AI 通道鉴权：解析 Bearer PAT → 校验 → IP 兜底限频 + 令牌级限频 → 懒更新 last_used_at。
 * 任何环节失败均抛 401/429，绝不回退 JWT。
 */
export function authenticateAi(event: H3Event): AiTokenRow {
  // IP 级兜底限频：拦截无效令牌暴力猜测（比令牌级限频宽松，但足以抑制扫描）
  const ip = getClientIP(event)
  checkRateLimit(`ai_ip:${ip}`, 300, 60_000)

  const header = getHeader(event, 'authorization') || ''
  if (!header.startsWith('Bearer ')) {
    throw createError({
      statusCode: 401,
      message: '缺少访问令牌',
      data: { error: '缺少访问令牌。请在 Authorization 头携带 Bearer favs_ai_... 形式的 PAT' },
    })
  }

  const raw = header.slice(7).trim()
  if (!raw.startsWith(PAT_PREFIX)) {
    throw createError({
      statusCode: 401,
      message: '令牌类型无效',
      data: { error: '令牌类型无效：AI 接口仅接受 favs_ai_ 开头的访问令牌，不接受登录凭证' },
    })
  }

  const row = verifyPat(raw)
  if (!row) {
    throw createError({
      statusCode: 401,
      message: '令牌无效或已吊销',
      data: { error: '令牌无效、已吊销或已过期' },
    })
  }

  // 令牌级限频（每令牌 600 次/分钟）
  checkRateLimit(`ai:${row.id}`, 600, 60_000)

  // 懒更新 last_used_at（5 分钟节流，降低写压力）
  const now = Date.now()
  if (!row.last_used_at || now - row.last_used_at > 5 * 60_000) {
    try {
      getRawDb().prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id)
      row.last_used_at = now
    } catch { /* 非关键路径，忽略 */ }
  }

  ;(event.context as any).aiToken = row
  return row
}

/** scope 校验：不满足抛 403 */
export function requireScope(event: H3Event, need: AiScope) {
  const row = (event.context as any).aiToken as AiTokenRow | undefined
  if (!row) {
    throw createError({
      statusCode: 401,
      message: '未鉴权',
      data: { error: '未鉴权' },
    })
  }
  if (!hasScope(row, need)) {
    throw createError({
      statusCode: 403,
      message: '令牌权限不足',
      data: { error: `该令牌缺少 ${need} 权限` },
    })
  }
}

/** 便捷取当前请求的令牌（可能为 undefined） */
export function getAiToken(event: H3Event): AiTokenRow | undefined {
  return (event.context as any).aiToken as AiTokenRow | undefined
}

// ─── 审计 ───────────────────────────────────────────────────────

/**
 * 审计落库（best-effort，失败不阻断请求）。
 * 只记录「method + path + 状态码」摘要，**绝不记录请求体内容**（可能含隐私/密钥）。
 */
export function auditAi(event: H3Event, statusCode: number) {
  const row = (event.context as any).aiToken as AiTokenRow | undefined
  if (!row) return
  try {
    const path = getRequestURL(event).pathname
    const scope = String((event.context as any).aiScope || 'read')
    getRawDb().prepare(
      `INSERT INTO ai_audit_logs
        (token_id, user_id, method, path, scope, status_code, ip, body_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.user_id,
      event.method,
      path,
      scope,
      statusCode,
      getClientIP(event),
      `${event.method} ${path} -> ${statusCode}`,
      Date.now(),
    )
  } catch { /* 审计失败不影响业务 */ }
}

// ─── 统一处理器 ─────────────────────────────────────────────────

/**
 * 统一的 AI 端点处理器：鉴权 → scope 校验 → 业务 → 审计。
 * 所有 `/api/ai/*` 端点必须经此包装（禁止直接用 requireAuth）。
 *
 * 审计范围：**scope 校验失败（403）也落审计** —— 用低权限令牌尝试写入/删除是典型的
 * 越权探测信号，必须留痕。鉴权阶段失败（401 无令牌 / 429 限频）无令牌上下文，无法审计。
 *
 * @param scope 固定 scope，或按请求动态判定的函数（如按 method 区分读写）
 */
export function defineAiHandler(
  scope: AiScope | ((event: H3Event) => AiScope),
  handler: (event: H3Event, token: AiTokenRow) => any,
) {
  return defineEventHandler(async (event) => {
    const token = authenticateAi(event)
    const need = typeof scope === 'function' ? scope(event) : scope
    ;(event.context as any).aiScope = need

    let status = 200
    try {
      requireScope(event, need)
      return await handler(event, token)
    } catch (err: any) {
      status = Number(err?.statusCode) || 500
      throw err
    } finally {
      auditAi(event, status)
    }
  })
}
