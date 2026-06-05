/**
 * 内存级请求频率限制器
 * 用于保护认证端点免受暴力破解
 */
import { createError, type H3Event } from 'h3'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const attempts = new Map<string, RateLimitEntry>()

// 定期清理过期条目（每 5 分钟）
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of attempts) {
      if (now > entry.resetAt) attempts.delete(key)
    }
  }, 5 * 60 * 1000)
}

/**
 * 检查请求频率限制
 * @param key 限制键（如 `auth:${ip}`）
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
