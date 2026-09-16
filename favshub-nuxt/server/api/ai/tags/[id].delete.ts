/**
 * DELETE /api/ai/tags/:id — 删除标签（delete）
 * Body: { confirm: true, dry_run? }
 *
 * 权限：仅管理员（与站点既有 `/api/tags/:id` 规则一致）。
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { deleteTag } from '../../../utils/ai-service'

export default defineAiHandler('delete', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return deleteTag(getRawDb(), token.user_id, id, body)
})
