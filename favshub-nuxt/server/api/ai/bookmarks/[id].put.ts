/**
 * PUT /api/ai/bookmarks/:id — 更新书签（write）
 * Body: { title?, url?, folder_id?, icon?, description?, label?, sort_order?, need_proxy?, login_required?, dry_run? }
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { updateBookmark } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return updateBookmark(getRawDb(), token.user_id, id, body)
})
