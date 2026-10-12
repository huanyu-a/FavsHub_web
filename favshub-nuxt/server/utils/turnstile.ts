/**
 * Cloudflare Turnstile 人机校验（游客通道）
 *
 * ## 为什么需要
 *
 * 原先只有 HMAC 签名算术题：题目是 2~9 的加减法，脚本写两行代码就能批量解，
 * 防不住刷量（该实现已整体移除，见下方「失败即拒绝」）。
 * Turnstile 由 Cloudflare 在浏览器侧做行为判分，服务端只发一次 siteverify，
 * 强度高得多，且不改变「游客无需登录」的产品形态。
 *
 * ## 实现要点（对齐 new-api 的 middleware/turnstile-check.go）
 *
 *   - 配置存 system_config，后台「人机校验」区可改；密钥不落代码、不进仓库
 *   - 前端拿 site key 渲染挂件，用户通过后拿到一次性 token
 *   - 服务端把 token + secret + remoteip 送 siteverify，只认 `success`
 *
 * ## 失败即拒绝（fail-closed）
 *
 * 挂件脚本来自 challenges.cloudflare.com，境内无代理访客可能加载失败。
 * 这里**刻意不留任何降级旁路**：脚本加载失败、令牌缺失、siteverify 网络异常、
 * 校验不通过 —— 一律拒绝提交（返回可读文案，前端提示重试）。
 * 理由：算术题两行代码就能批量解，只要它作为兜底通道存在，整体强度就退化到算术题水平。
 * 关闭 `turnstile_enabled`（或任一密钥留空）时游客通道整体关闭，同样不放行。
 */
import { getConfig } from './config'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** siteverify 是同步阻塞校验，必须设超时：Cloudflare 抖动不能拖垮提交接口 */
const VERIFY_TIMEOUT_MS = 8000

export interface TurnstileConfig {
  enabled: boolean
  siteKey: string
  secretKey: string
}

/**
 * Cloudflare 官方测试密钥（site key / secret 形如 `1x000…AA`）。
 *
 * 测试密钥在**任意域名**下都恒返回 `success:true`（接受 dummy token）：一旦误配到生产，
 * 挑战端点照常返回 provider=turnstile、挂件照常渲染、提交照常 200 —— 看起来全都正常，
 * 实际等于没有校验（静默放行），与 fail-closed 相悖。故直接判定为未启用（游客通道关闭）。
 * 参考：https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
const TEST_KEY_RE = /^[123]x0{8,}/
let warnedTestKey = false

/** 读取 Turnstile 配置；密钥不全或为官方测试密钥时 enabled 恒为 false —— 游客通道整体关闭（不放行） */
export function getTurnstileConfig(): TurnstileConfig {
  const siteKey = getConfig('turnstile_site_key').trim()
  const secretKey = getConfig('turnstile_secret_key').trim()
  const testKey = TEST_KEY_RE.test(siteKey) || TEST_KEY_RE.test(secretKey)
  if (testKey && !warnedTestKey) {
    warnedTestKey = true
    console.warn('[Turnstile] 检测到 Cloudflare 官方测试密钥（恒真放行），已判定为未启用 —— 游客通道关闭')
  }
  return {
    enabled: getConfig('turnstile_enabled') === 'true' && !!siteKey && !!secretKey && !testKey,
    siteKey,
    secretKey,
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
  if (!cfg.enabled) return { ok: false, reason: 'failed', message: '人机校验未启用，暂不接受游客提交' }

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
