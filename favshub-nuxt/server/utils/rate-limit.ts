/**
 * 内存级请求频率限制器
 * 用于保护认证端点免受暴力破解
 * 支持 IP 级和用户名级双重限频
 *
 * 限制：基于进程内存的 Map，仅适用于单实例部署。
 * 若未来多实例部署（如负载均衡后端），每个实例各自计数，
 * 限频阈值实际被放大 N 倍。届时需迁移到 Redis 或共享存储。
 *
 * T5（2026-10-30）在本文件末尾追加了「滑动窗口限流引擎 + 阈值表」：
 *   - 全站 API 的 IP 分层限频 + 同 IP 并发上限 → server/middleware/rate-limit.ts
 *   - AI 通道的 10 次/分钟 + 50 次/30 分钟双窗口、per-令牌 / per-IP 并发上限 → server/utils/ai-auth.ts
 * 上面这段固定窗口实现保持原样，继续服务于 30+ 处既有认证类调用点。
 */
import { createError, setResponseHeader, type H3Event } from 'h3'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const attempts = new Map<string, RateLimitEntry>()

// P11/S8: 清理定时器移入插件作用域，由 server/plugins/rate-limit-cleanup.ts 启动/停止，
// 避免模块顶层 setInterval 在 HMR/多实例时泄漏
let cleanupTimer: ReturnType<typeof setInterval> | null = null

export function startRateLimitCleanup(intervalMs = 5 * 60 * 1000) {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    sweepRateLimitState()
  }, intervalMs)
}

export function stopRateLimitCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

/**
 * 检查请求频率限制
 * @param key 限制键（如 `auth:${ip}` 或 `login_user:${username}`）
 * @param limit 时间窗口内最大请求数
 * @param windowMs 时间窗口（毫秒）
 */
export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const entry = attempts.get(key)

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return
  }

  entry.count++
  if (entry.count > limit) {
    throw createError({
      statusCode: 429,
      data: { error: '请求过于频繁，请稍后再试' },
    })
  }
}

/**
 * 记录一次失败的登录尝试（用于账户级锁定）
 * 超过阈值后抛出 429 错误
 */
export function recordFailedLogin(username: string) {
  const key = `login_fail:${username.toLowerCase()}`
  const limit = 5 // 5 次失败后锁定
  const windowMs = 15 * 60 * 1000 // 15 分钟窗口
  const now = Date.now()
  const entry = attempts.get(key)

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return
  }

  entry.count++
  if (entry.count >= limit) {
    const remainingMs = entry.resetAt - now
    const remainingMin = Math.ceil(remainingMs / 60000)
    throw createError({
      statusCode: 429,
      data: { error: `账户已被临时锁定，请在 ${remainingMin} 分钟后重试` },
    })
  }
}

/**
 * 清除用户的失败登录记录（登录成功时调用）
 */
export function clearFailedLogin(username: string) {
  attempts.delete(`login_fail:${username.toLowerCase()}`)
}

/**
 * 是否为内网/回环地址（即「对端是本机自己的反向代理」）。
 *
 * 用于判断 `X-Real-IP` 是否可信：只有当直连对端是内网地址时才采信该头，
 * 否则公网客户端可以直接伪造它绕过限频。
 */
function isPrivatePeer(ip: string): boolean {
  if (!ip) return false
  // IPv4-mapped IPv6（如 ::ffff:172.31.0.1）
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (v4 === '::1' || v4 === '127.0.0.1') return true
  if (/^127\./.test(v4)) return true
  if (/^10\./.test(v4)) return true
  if (/^192\.168\./.test(v4)) return true
  const m = v4.match(/^172\.(\d+)\./)
  if (m) {
    const second = Number(m[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

/**
 * 安全获取客户端 IP
 *
 * 解析优先级：
 *   1. `trustProxy` 显式开启 → 取 `X-Forwarded-For` 首段（既有行为，兼容配置）
 *   2. 直连对端为**内网地址**（即本站自己的 nginx 容器）→ 采信其 `X-Real-IP`
 *   3. 回退到 H3 内置对端地址
 *
 * 第 2 条是本站在「宝塔 nginx → docker nginx → 应用」双层代理下的必要修正：
 * 应用侧读到的对端地址恒为 docker 网关地址，**所有访客的 IP 完全相同** ——
 * 这会让按 IP 限频退化成「全站共享配额」，也让任何基于 IP 的判重失效。
 * 内层 nginx 已配置 realip 模块，`X-Real-IP` 即经可信链还原后的真实客户端 IP。
 *
 * 安全性：仅当对端是内网地址时才采信 `X-Real-IP`；公网直连（如容器端口意外暴露）
 * 时该头不可信，回退到对端地址，避免伪造绕过限频。
 *
 * ⚠️ `NUXT_TRUST_PROXY=true` 只有当**直连对端就是你自己信任的反代**时才安全。
 * 本站在「宝塔 nginx → docker nginx → 应用」下**不需要**开启它：内层 nginx 已用 realip
 * 还原并写入 `X-Real-IP`，而对端是内网网关，走的是上面第 2 条分支。
 * 若前面的反代用 `$proxy_add_x_forwarded_for`（追加而非覆盖），开启 trustProxy 会让
 * 「客户端自带的 XFF 首段」变成限频键 —— 换个头就绕过配额。
 */
export function getClientIP(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const trustProxy = config.trustProxy === 'true' || config.trustProxy === true

  if (trustProxy) {
    // 优先 `X-Real-IP`：反代通常用 `$remote_addr` 覆盖它，客户端伪造不了；
    // 而 `X-Forwarded-For` 是**追加**的，首段可以被客户端自己塞进去（见下方警告）。
    const real = getRequestHeader(event, 'x-real-ip')
    if (real && real.trim()) return real.trim()
    const xff = getRequestHeader(event, 'x-forwarded-for')
    if (xff) {
      // 取第一个 IP（最接近客户端的）
      return xff.split(',')[0].trim()
    }
  }

  const peer = getRequestIP(event) || ''

  // 对端是本机反代（内网）→ 采信 nginx 还原后的真实客户端 IP
  if (isPrivatePeer(peer)) {
    const real = getRequestHeader(event, 'x-real-ip')
    if (real && real.trim()) return real.trim()
  }

  return peer || 'unknown'
}

// ══════════════════════════════════════════════════════════════════════════════
// T5 — 滑动窗口限流引擎 + 阈值表
//
// 为什么另起一套（而不是继续用上面的固定窗口）：
//   * 固定窗口在**窗口边界**处可短时放行 2×limit（先打满 A 窗口、再打满 B 窗口），
//     对「10 次/分钟」这种小阈值来说是 2 倍误差，不可接受；
//   * 滑动窗口记录窗口内**每次请求的时间戳**，精度到单请求，没有边界双倍问题。
//
// 内存边界（这是内存限流唯一必须写死的东西）：
//   * 单键最多保存 `limit` 个时间戳 —— **被拒的请求不记录**，所以挨打时数组不再增长；
//   * 数组用 head 游标 + 超过 64 条时 slice 压缩，长度被压在 limit + 64 以内；
//   * 全局键数上限 `FAVSHUB_RL_MAX_KEYS`（默认 20000），超了按「最久未使用」淘汰。
//     键 = sha256(IP)[:16]（见 rateKeyForIp），不是明文 IP。
//   * 仍然只是**进程内**状态：重启即清空、多实例各算一份。详见 CLAUDE.md「限流模型」。
//
// 可测性（「不真等 30 分钟」怎么做的）：
//   所有阈值与窗口长度都能用环境变量覆盖（FAVSHUB_RL_*），所以自测把 30 分钟窗口
//   缩成 3 秒跑同一条代码路径；`consumeWindow` 另留 `now` 参数供注入时钟。
// ══════════════════════════════════════════════════════════════════════════════

/** 把毫秒窗口渲染成人话（60000 → 「分钟」、1800000 → 「30 分钟」）：错误文案与 describe 端点共用 */
export function windowLabel(windowMs: number): string {
  if (windowMs === 60_000) return '分钟'
  if (windowMs === 1000) return '秒'
  if (windowMs >= 60_000 && windowMs % 60_000 === 0) return `${windowMs / 60_000} 分钟`
  if (windowMs >= 1000 && windowMs % 1000 === 0) return `${windowMs / 1000} 秒`
  return `${windowMs} 毫秒`
}

/** 读整数环境变量；非法值告警并回退默认值（配置写错不能让站点直接 500） */
function envInt(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || String(raw).trim() === '') return def
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n) || n < min || n > max) {
    console.warn(`[rate-limit] ${name}="${raw}" 非法（需 ${min}..${max} 的整数），回退默认值 ${def}`)
    return def
  }
  return Math.floor(n)
}

function envBool(name: string, def: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || String(raw).trim() === '') return def
  const v = String(raw).trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  console.warn(`[rate-limit] ${name}="${raw}" 非法（需布尔），回退默认值 ${def}`)
  return def
}

/** 逗号分隔的**精确路径**列表 —— 不做前缀推导，避免 /api/favicon 被当成前缀而放行同前缀的其他路由 */
function envPaths(name: string, def: string[]): string[] {
  const raw = process.env[name]
  if (raw === undefined || String(raw).trim() === '') return def
  return String(raw).split(',').map(s => s.trim()).filter(Boolean)
}

export interface RateLimitConfig {
  ai: {
    /** 令牌级短窗口：默认 10 次/分钟 */
    perMin: number
    windowMs: number
    /** 令牌级长窗口：默认 50 次/30 分钟 */
    burst: number
    burstWindowMs: number
    /** IP 级兜底（比令牌级宽松，用于挡无效令牌暴力猜测） */
    ipPerMin: number
    ipBurst: number
    /** 同时在途请求数上限 */
    concurrency: number
    ipConcurrency: number
  }
  site: {
    enabled: boolean
    readPerMin: number
    writePerMin: number
    /** 浏览器自然会突发拉取的资源类 GET（如 /api/favicon 的兜底图标） */
    assetPerMin: number
    windowMs: number
    concurrency: number
    /** 精确路径：探活等豁免 */
    exemptPrefixes: string[]
    /** 精确路径：走 asset 档 */
    assetPrefixes: string[]
    maxKeys: number
  }
}

let cachedConfig: RateLimitConfig | null = null

/**
 * 阈值表（**唯一真源**：错误文案、describe 端点、文档都从这里取）。
 *
 * 环境变量在进程启动时读一次并缓存；命名用 `FAVSHUB_RL_*` 而不是 `NUXT_*`：
 * 这些键没有（也不该有）登记进 nuxt.config 的 runtimeConfig，直接用 process.env 读，
 * 避免「设了 NUXT_ 前缀却没生效」这类误导。
 */
export function getRateLimitConfig(): RateLimitConfig {
  if (cachedConfig) return cachedConfig
  cachedConfig = {
    ai: {
      perMin: envInt('FAVSHUB_RL_AI_PER_MIN', 10, 1, 1_000_000),
      windowMs: envInt('FAVSHUB_RL_AI_WINDOW_MS', 60_000, 1_000, 86_400_000),
      burst: envInt('FAVSHUB_RL_AI_BURST', 50, 1, 1_000_000),
      burstWindowMs: envInt('FAVSHUB_RL_AI_BURST_WINDOW_MS', 30 * 60_000, 1_000, 30 * 86_400_000),
      ipPerMin: envInt('FAVSHUB_RL_AI_IP_PER_MIN', 60, 1, 1_000_000),
      ipBurst: envInt('FAVSHUB_RL_AI_IP_BURST', 200, 1, 1_000_000),
      concurrency: envInt('FAVSHUB_RL_AI_CONCURRENCY', 4, 1, 1000),
      ipConcurrency: envInt('FAVSHUB_RL_AI_IP_CONCURRENCY', 8, 1, 1000),
    },
    site: {
      enabled: envBool('FAVSHUB_RL_SITE_ENABLED', true),
      readPerMin: envInt('FAVSHUB_RL_SITE_READ_PER_MIN', 600, 1, 1_000_000),
      writePerMin: envInt('FAVSHUB_RL_SITE_WRITE_PER_MIN', 120, 1, 1_000_000),
      assetPerMin: envInt('FAVSHUB_RL_SITE_ASSET_PER_MIN', 1200, 1, 1_000_000),
      windowMs: envInt('FAVSHUB_RL_SITE_WINDOW_MS', 60_000, 1_000, 86_400_000),
      concurrency: envInt('FAVSHUB_RL_SITE_CONCURRENCY', 24, 1, 10_000),
      exemptPrefixes: envPaths('FAVSHUB_RL_SITE_EXEMPT', ['/api/health']),
      assetPrefixes: envPaths('FAVSHUB_RL_SITE_ASSET_PATHS', ['/api/favicon']),
      maxKeys: envInt('FAVSHUB_RL_MAX_KEYS', 20_000, 100, 1_000_000),
    },
  }
  return cachedConfig
}

/** AI 通道限频摘要（人话）—— describe 端点与技能文档共用，杜绝「文档一套代码一套」 */
export function aiRateLimitText(): string {
  const c = getRateLimitConfig().ai
  return `每令牌 ${c.perMin} 次/${windowLabel(c.windowMs)} 且 ${c.burst} 次/${windowLabel(c.burstWindowMs)}，`
    + `同令牌并发 ${c.concurrency}；同 IP 兜底 ${c.ipPerMin} 次/${windowLabel(c.windowMs)}`
    + `、${c.ipBurst} 次/${windowLabel(c.burstWindowMs)}，同 IP 并发 ${c.ipConcurrency}`
}

// ─── 滑动窗口（逐请求时间戳） ───────────────────────────────────────────

interface WindowBucket {
  /** 升序时间戳；head 之前的是已滑出窗口的过期项 */
  hits: number[]
  head: number
  /** 该键使用的窗口长度（清理时要靠它判断死活） */
  windowMs: number
}

const windowBuckets = new Map<string, WindowBucket>()

/** head 超过这个值就 slice 压缩一次，避免数组只涨不缩 */
const COMPACT_AT = 64

let lastSweepAt = 0

export interface WindowDecision {
  allowed: boolean
  limit: number
  remaining: number
  /** 建议的 Retry-After（秒，至少 1） */
  retryAfterSec: number
}

/**
 * 消耗一次窗口配额。**被拒绝的请求不落桶** —— 这既是内存边界的前提，
 * 也保证攻击者不能靠持续打满把某个键的数组撑大。
 *
 * @param now 可注入时钟（默认 Date.now()），单测/自测需要「不真等 30 分钟」时用
 */
export function consumeWindow(key: string, limit: number, windowMs: number, now: number = Date.now()): WindowDecision {
  if (!(limit > 0) || !(windowMs > 0)) {
    return { allowed: false, limit: 0, remaining: 0, retryAfterSec: 1 }
  }

  const cutoff = now - windowMs
  let bucket = windowBuckets.get(key)
  if (bucket) {
    // 删掉再插回 = 移到 Map 末尾；Map 迭代顺序即「最久未使用在前」，供淘汰使用
    windowBuckets.delete(key)
  } else {
    bucket = { hits: [], head: 0, windowMs }
  }
  bucket.windowMs = windowMs

  let hits = bucket.hits
  let head = bucket.head
  while (head < hits.length && hits[head] <= cutoff) head++
  if (head > COMPACT_AT) {
    hits = hits.slice(head)
    head = 0
  }

  const used = hits.length - head
  if (used >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[head] + windowMs - now) / 1000))
    bucket.hits = hits
    bucket.head = head
    windowBuckets.set(key, bucket)
    maybeSweep(now)
    return { allowed: false, limit, remaining: 0, retryAfterSec }
  }

  hits.push(now)
  bucket.hits = hits
  bucket.head = head
  windowBuckets.set(key, bucket)
  maybeSweep(now)
  return { allowed: true, limit, remaining: limit - used - 1, retryAfterSec: 0 }
}

/** 键基数超上限时的兜底清理（每秒最多一次，避免 O(n) 扫描变成放大攻击的放大器） */
function maybeSweep(now: number): void {
  if (windowBuckets.size <= getRateLimitConfig().site.maxKeys) return
  if (now - lastSweepAt < 1000) return
  lastSweepAt = now
  sweepRateLimitState(now)
}

/**
 * 清扫两套限流状态：过期的固定窗口条目、滑出窗口的桶，并把键数压回上限。
 * 由 `server/plugins/rate-limit-cleanup.ts` 每 5 分钟调用一次。
 */
export function sweepRateLimitState(now: number = Date.now()): { legacy: number; windows: number; evicted: number } {
  let legacy = 0
  for (const [key, entry] of attempts) {
    if (now > entry.resetAt) {
      attempts.delete(key)
      legacy++
    }
  }

  let windows = 0
  for (const [key, bucket] of windowBuckets) {
    const last = bucket.hits.length ? bucket.hits[bucket.hits.length - 1] : 0
    if (!last || last + bucket.windowMs <= now) {
      windowBuckets.delete(key)
      windows++
    }
  }

  let evicted = 0
  const maxKeys = getRateLimitConfig().site.maxKeys
  while (windowBuckets.size > maxKeys) {
    const oldest = windowBuckets.keys().next()
    if (oldest.done) break
    windowBuckets.delete(oldest.value)
    evicted++
  }
  if (evicted > 0) {
    console.warn(`[rate-limit] 限流键数超上限，已淘汰最久未使用的 ${evicted} 个键`)
  }
  return { legacy, windows, evicted }
}

// ─── 并发（同时在途请求数） ─────────────────────────────────────────────

const inflight = new Map<string, number>()

/**
 * 尝试占用一个并发槽位。成功返回**幂等**的释放函数；超限返回 null。
 *
 * 幂等是这里的关键：同一个 release 会被 `finally` 与 `res.on('close')` 各调一次
 * （正常结束走 finally，客户端中途断开走 close），重复调用必须只扣一次，
 * 否则计数会被扣成负数、限流形同虚设。
 */
export function tryAcquireConcurrency(key: string, limit: number): (() => void) | null {
  const cur = inflight.get(key) ?? 0
  if (!(limit > 0) || cur >= limit) return null
  inflight.set(key, cur + 1)

  let released = false
  return () => {
    if (released) return
    released = true
    const n = (inflight.get(key) ?? 1) - 1
    if (n <= 0) inflight.delete(key)
    else inflight.set(key, n)
  }
}

/**
 * 占用并发槽位并把释放挂到响应关闭事件上 —— **异常 / 超时 / 客户端中途断开**
 * 三条路径都会触发 `res` 的 `close`，因此计数不会泄漏。
 *
 * 调用方仍应在 `try/finally` 里再调一次返回的 release（双保险，且幂等）。
 * 站点级中间件无法用 try/finally 包住下游，只能靠 close 事件。
 */
export function acquireRequestSlot(
  event: H3Event,
  key: string,
  limit: number,
): (() => void) | null {
  const release = tryAcquireConcurrency(key, limit)
  if (!release) return null
  try {
    const res = event.node?.res as any
    if (res && typeof res.once === 'function') {
      if (res.writableEnded || res.destroyed) release()
      else res.once('close', release)
    }
  } catch {
    /* 拿不到 res（如单测里的事件桩）时由调用方的 finally 兜底 */
  }
  return release
}

/** 查当前在途数（仅自测与观测用） */
export function inflightCount(key: string): number {
  return inflight.get(key) ?? 0
}

// ─── 统一的 429 错误构造 ────────────────────────────────────────────────

/**
 * 构造 429 并附 `Retry-After`。
 *
 * 这里**必须**先把响应头写进 event，再 throw：本仓所有 API 错误体都由
 * `server/plugins/error-handler.ts` 统一接管（只输出 `{ error }`），它只改
 * status 与 content-type，不会清掉已写的头，所以 Retry-After 能带出去。
 * 错误文案里同时写清秒数，保证客户端即使只看 body 也能退避。
 */
export function rateLimitError(event: H3Event, label: string, retryAfterSec: number, detail?: string) {
  const sec = Math.max(1, Math.ceil(retryAfterSec || 1))
  try {
    setResponseHeader(event, 'Retry-After', String(sec))
    setResponseHeader(event, 'X-RateLimit-Reason', label)
  } catch {
    /* 头写不进去不改变 429 语义 */
  }
  const tail = detail ? `${detail}；` : ''
  return createError({
    statusCode: 429,
    data: { error: `超出限频（${label}）：${tail}请在 ${sec} 秒后重试` },
  })
}
