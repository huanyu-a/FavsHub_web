/**
 * GET /api/ai/token-deals — Token 白嫖通告列表（read）
 * Query: ?q=&region=&quality=&mine=&limit=&page=
 *
 * 默认返回公开的 approved 通告 + 自己发布的全部（含 pending / rejected）。
 */
import { getQuery } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { listTokenDeals } from '../../../utils/ai-service'

export default defineAiHandler('read', async (event, token) => {
  return listTokenDeals(getRawDb(), token.user_id, getQuery(event))
})
