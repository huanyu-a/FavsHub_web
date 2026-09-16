/**
 * POST /api/ai/prompts — 创建提示词（write）
 * Body: { title, content, description?, folder_id?, tags?, login_required?, dry_run? }
 *
 * 内容变更会自动创建初始版本记录（1.0.0）。
 */
import { readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { createPrompt } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const body = await readBody(event).catch(() => ({}))
  return createPrompt(getRawDb(), token.user_id, body)
})
