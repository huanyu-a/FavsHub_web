/**
 * Nitro 服务端插件 — 限频器过期条目清理定时器
 * P11/S8: 将 rate-limit 的清理 setInterval 纳入插件作用域，
 * 进程退出（SIGINT/SIGTERM）时清除，避免热更新/多实例泄漏。
 */
import { startRateLimitCleanup, stopRateLimitCleanup } from '../utils/rate-limit'

export default defineNitroPlugin(() => {
  startRateLimitCleanup()

  const shutdown = () => {
    stopRateLimitCleanup()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
})
