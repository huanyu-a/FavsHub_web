/**
 * GET /api/auth/register-challenge — 注册通道的人机校验方式
 *
 * 与游客通道同一套 Turnstile 挂件与密钥；未启用时返回 `provider:'disabled'`，
 * 前端据此**禁止提交注册**（fail-closed，无降级通道）。
 */
import { issueHumanChallenge } from '../../utils/human-check'

export default defineEventHandler(() =>
  issueHumanChallenge({ disabledMessage: '人机校验未启用，暂时无法注册，请联系管理员' }),
)
