/**
 * GET /api/token-deals/guest-challenge — 游客发布通告的人机校验
 *
 * 按站点配置下发：
 *   - Turnstile 已配置 → { provider: 'turnstile', site_key }
 *     前端渲染挂件，用户通过后把一次性令牌随提交回传（body.turnstile_token）
 *   - 未配置/已关闭 → { provider: 'disabled', message }
 *     游客通道整体关闭，前端直接提示不可提交
 *
 * 没有算术题降级通道：挂件加载失败即拒绝，不给刷量脚本留旁路。
 * 服务端零 session、零外部状态，重启不影响在途挑战。
 */
import { issueHumanChallenge } from '../../utils/guest-reviews'

export default defineEventHandler(() => issueHumanChallenge())
