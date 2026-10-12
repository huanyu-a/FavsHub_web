/**
 * Cloudflare Turnstile 人机校验（游客通道）
 *
 * ## 为什么需要
 *
 * 原先只有 HMAC 签名算术题（`guest-reviews.ts` 的 createGuestChallenge）：
 * 题目是 2~9 的加减法，脚本写两行代码就能批量解，防不住刷量。
 * Turnstile 由 Cloudflare 在浏览器侧做行为判分，服务端只发一次 siteverify，
 * 强度高得多，且不改变「游客无需登录」的产品形态。
 *
 * ## 实现要点（对齐 new-api 的 middleware/turnstile-check.go）
 *
 *   - 配置存 system_config，后台「人机校验」区可改；密钥不落代码、不进仓库
 *   - 前端拿 site key 渲染挂件，用户通过后拿到一次性 token
 *   - 服务端把 token + secret + remoteip 送 siteverify，只认 `success`
 *
 * ## 境内可达性
 *
 * 挂件脚本来自 challenges.cloudflare.com，境内无代理访客可能加载失败。
 * 因此 `turnstile_math_fallback` 打开时允许回落到算术题（前端组件加载失败
 * 或超时后自动带 `?fallback=1` 重新要一道算术题），避免把访客彻底挡在门外。
 * 注意：降级开着时，刷量脚本也可以选择降级通道，实际强度取决于算术题；
 * 确认访客都能加载挂件后，可关闭降级以获得完整强度。
 */
import { getConfig } from './config'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** siteverify 是同步阻塞校验，必须设超时：Cloudflare 抖动不能拖垮提交接口 */
const VERIFY_TIMEOUT_MS = 8000

export interface TurnstileConfig {
  enabled: boolean
  siteKey: string
  secretKey: string
  /** 挂件加载失败时是否允许回落算术题 */
  mathFallback: boolean
}

/** 读取 Turnstile 配置；密钥不全时 enabled 恒为 false（避免配错就卡死全站游客通道） */
export function getTurnstileConfig(): TurnstileConfig {
  const siteKey = getConfig('turnstile_site_key').trim()
  const secretKey = getConfig('turnstile_secret_key').trim()
  return {
    enabled: getConfig('turnstile_enabled') === 'true' && !!siteKey && !!secretKey,
    siteKey,
    secretKey,
    mathFallback: getConfig('turnstile_math_fallback') !== 'false',
  }
}

export type TurnstileVerifyResult =
  | { ok: true; hostname: string }
  | { ok: false; reason: 'missing' | 'expired' | 'failed' | 'unavailable'; message: string }

/**
 * 校验前端拿到的 Turnstile token。
 *
 * 令牌一次性、有效期 300s：重复提交同一 token 会拿到 timeout-or-duplicate，
 * 此时返回 expired，前端需 reset 挂件重新取 token，而不是让用户干等。
 * 网络失败/超时一律不放行（放行等于关掉校验），返回 unavailable 交调用方处置。
 */
export async function verifyTurnstileToken(token: unknown, remoteIp: string): Promise<TurnstileVerifyResult> {
  const tokenStr = String(token ?? '').trim()
  if (!tokenStr) return { ok: false, reason: 'missing', message: '请先完成人机验证' }

  const cfg = getTurnstileConfig()
  if (!cfg.enabled) return { ok: false, reason: 'failed', message: '人机校验未启用，请刷新页面重试' }

  const form = new URLSearchParams({ secret: cfg.secretKey, response: tokenStr })
  if (remoteIp) form.set('remoteip', remoteIp)

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn('[Turnstile] siteverify 返回非 2xx:', res.status)
      return { ok: false, reason: 'unavailable', message: '人机验证服务暂时不可用，请稍后重试' }
    }
    const data = await res.json() as { success?: boolean; hostname?: string; 'error-codes'?: string[] }
    if (data?.success) return { ok: true, hostname: String(data.hostname ?? '') }

    const codes = data?.['error-codes'] ?? []
    console.warn('[Turnstile] 校验未通过:', codes.join(',') || '(无 error-codes)')
    if (codes.includes('timeout-or-duplicate')) {
      return { ok: false, reason: 'expired', message: '人机验证已过期，请重新验证' }
    }
    return { ok: false, reason: 'failed', message: '人机验证未通过，请重新验证' }
  } catch (err: any) {
    console.warn('[Turnstile] siteverify 请求失败:', err?.message || err)
    return { ok: false, reason: 'unavailable', message: '人机验证服务暂时不可用，请稍后重试' }
  }
}
