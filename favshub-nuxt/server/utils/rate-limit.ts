/**
 * 内存级请求频率限制器
 * 用于保护认证端点免受暴力破解
 * 支持 IP 级和用户名级双重限频
 *
 * 限制：基于进程内存的 Map，仅适用于单实例部署。
 * 若未来多实例部署（如负载均衡后端），每个实例各自计数，
 * 限频阈值实际被放大 N 倍。届时需迁移到 Redis 或共享存储。
 */
import { createError, type H3Event } from 'h3'

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
    const now = Date.now()
    for (const [key, entry] of attempts) {
      if (now > entry.resetAt) attempts.delete(key)
    }
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
 */
export function getClientIP(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const trustProxy = config.trustProxy === 'true' || config.trustProxy === true

  if (trustProxy) {
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
