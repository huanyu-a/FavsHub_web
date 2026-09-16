/**
 * POST /api/ai/token-deals — 发布 Token 白嫖通告（write）
 * Body: { provider, title, url, call_url?, quota?, models?, region?, quality?, source_tag?, expires_at?, note?, dry_run? }
 *
 * 管理员发布直接上线（approved）；普通用户发布进入待审核（pending）。
 */
import { readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { createTokenDeal } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const body = await readBody(event).catch(() => ({}))
  return createTokenDeal(getRawDb(), token.user_id, body)
})
