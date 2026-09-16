/**
 * GET /api/ai/prompts/:id — 提示词详情（read，含标签）
 */
import { getRouterParams } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { getPromptDetail } from '../../../utils/ai-service'

export default defineAiHandler('read', async (event, token) => {
  const { id } = getRouterParams(event)
  return { prompt: getPromptDetail(getRawDb(), token.user_id, String(id)) }
})
