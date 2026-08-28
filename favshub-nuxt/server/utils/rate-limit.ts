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
 * 安全获取客户端 IP
 * 仅在配置了可信代理时信任 X-Forwarded-For
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

  // 回退到 H3 内置 IP 获取（不使用 xForwardedFor）
  const ip = getRequestIP(event) || 'unknown'
  return ip
}
