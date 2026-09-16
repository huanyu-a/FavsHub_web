/**
 * DELETE /api/ai/bookmarks/:id — 删除书签（delete）
 * Body: { confirm: true, dry_run? } —— 必须显式确认，否则 400
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { deleteBookmark } from '../../../utils/ai-service'

export default defineAiHandler('delete', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return deleteBookmark(getRawDb(), token.user_id, id, body)
})
