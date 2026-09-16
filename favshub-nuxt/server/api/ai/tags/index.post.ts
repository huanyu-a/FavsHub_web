/**
 * POST /api/ai/tags — 创建标签（write）
 * Body: { name, color?, dry_run? }
 *
 * 幂等：同名标签直接返回已存在的那条，不会重复创建。
 */
import { readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { createTag } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const body = await readBody(event).catch(() => ({}))
  return createTag(getRawDb(), token.user_id, body)
})
