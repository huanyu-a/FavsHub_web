/**
 * GET /api/token-deals/guest-challenge — 游客发布通告的人机校验题
 *
 * 与游客评测同一套算术题：答案以 HMAC 签名令牌下发，服务端零状态、
 * 无 session、无外部服务，重启也不影响在途挑战。
 * 提交通告时把 token 与答案一并回传 POST /api/token-deals（游客通道）。
 */
import { createGuestChallenge } from '../../utils/guest-reviews'

export default defineEventHandler(() => createGuestChallenge())
