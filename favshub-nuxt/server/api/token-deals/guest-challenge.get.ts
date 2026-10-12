/**
 * GET /api/token-deals/guest-challenge — 游客发布通告的人机校验
 *
 * 按站点配置决定下发方式：
 *   - Turnstile 已启用 → { provider: 'turnstile', site_key, fallback_available }，
 *     前端渲染挂件并把 token 随提交回传（body.turnstile_token）
 *   - 否则 → { provider: 'math', question, token, expires_in }，答案在签名令牌里，
 *     前端把 token 与答案回传（body.challenge_token / challenge_answer）
 *
 * 前端挂件加载失败时可带 ?fallback=1 主动要一道算术题（仅「允许降级」时生效）。
 * 服务端零 session、零外部状态，重启不影响在途挑战。
 */
import { getQuery } from 'h3'
import { issueHumanChallenge } from '../../utils/guest-reviews'

export default defineEventHandler((event) => {
  const { fallback } = getQuery(event)
  return issueHumanChallenge(String(fallback ?? '') === '1')
})
