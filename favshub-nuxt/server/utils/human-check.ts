/**
 * 人机校验统一入口（Cloudflare Turnstile）—— 游客发布、游客评测、注册共用。
 *
 * ## 策略：失败即拒绝（fail-closed），没有任何降级通道
 *
 * 挂件脚本加载失败、令牌缺失/过期/复用、siteverify 网络异常或超时、校验不通过 ——
 * 一律拒绝，不提供算术题等兜底通道（那等于没做校验，等于把通道敞开给脚本）。
 * 未配置密钥 / 关闭总开关 / 误配官方测试密钥 → 视为「未启用」，调用方一并拒绝。
 *
 * - 前端：`components/common/TurnstileBox.vue` + `utils/turnstile.ts`（挂件加载与重试）
 * - 服务端复核：`server/utils/turnstile.ts`（siteverify）
 *
 * ## 通道开关
 *
 * 游客通道（发布/评测）恒开启；注册通道可由后台 `register_turnstile_enabled` 关闭
 * （见 `server/api/auth/register.post.ts`），方便站点主按自身情况取舍。
 */
import { getClientIP } from './rate-limit'
import { getTurnstileConfig, verifyTurnstileToken } from './turnstile'

/** 默认文案（游客通道口径；注册通道传 opts 换成自己的措辞） */
const DEFAULT_DISABLED_MESSAGE = '人机校验未启用，暂不接受游客提交'
const DEFAULT_MISSING_MESSAGE = '请先完成人机验证'

export type HumanChallenge =
  | { provider: 'turnstile'; site_key: string }
  | { provider: 'disabled'; message: string }

/**
 * 下发人机校验方式。
 *
 * 只可能有两种结果：Turnstile 已配置 → 前端渲染挂件；未配置/已关闭 → 对应通道关闭。
 * **没有算术题降级**：挂件加载失败或校验不通过一律拒绝，避免刷量脚本改走兜底通道。
 */
export function issueHumanChallenge(opts: { disabledMessage?: string } = {}): HumanChallenge {
  const cfg = getTurnstileConfig()
  if (!cfg.enabled) {
    return { provider: 'disabled', message: opts.disabledMessage || DEFAULT_DISABLED_MESSAGE }
  }
  return { provider: 'turnstile', site_key: cfg.siteKey }
}

/**
 * 校验提交的人机凭据（fail-closed）。
 *
 * 唯一通过路径：带有效 `turnstile_token` 且通过 Cloudflare siteverify。
 * 未配置密钥、没带令牌、令牌过期或复用、siteverify 网络异常/超时 —— 全部拒绝。
 *
 * @returns null 表示通过；否则返回给用户看的错误文案
 */
export async function assertHumanCheck(
  event: any,
  body: any,
  opts: { disabledMessage?: string; missingMessage?: string } = {},
): Promise<string | null> {
  const cfg = getTurnstileConfig()
  if (!cfg.enabled) return opts.disabledMessage || DEFAULT_DISABLED_MESSAGE
  const token = String(body?.turnstile_token ?? '').trim()
  if (!token) return opts.missingMessage || DEFAULT_MISSING_MESSAGE
  const result = await verifyTurnstileToken(token, getClientIP(event))
  return result.ok ? null : result.message
}
