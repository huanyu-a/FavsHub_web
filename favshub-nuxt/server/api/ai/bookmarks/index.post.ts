/**
 * POST /api/ai/bookmarks — 创建书签（write）
 *
 * Body 支持两种形态：
 *   单条：{ title, url, folder_id?, icon?, description?, label?, login_required?, need_proxy?, dry_run? }
 *   批量：{ items: [ {...}, {...} ], dry_run? }   —— 上限 50 条
 *
 * dry_run:true 时只返回将执行的变更，不落库。
 */
import { readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { createBookmarks } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const body = await readBody(event).catch(() => ({}))
  return createBookmarks(getRawDb(), token.user_id, body)
})
