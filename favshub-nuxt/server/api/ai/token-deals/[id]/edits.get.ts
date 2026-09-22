/**
 * GET /api/ai/token-deals/:id/edits — 某通告的修改建议列表（read）
 *
 * Query: status=pending|approved|rejected|all
 *
 * 通告作者与管理员可见全部（含已结案，供审核与追溯）；
 * 其他用户仅可见自己提交的建议。
 */
import { getRouterParams, getQuery } from 'h3'
import { getRawDb } from '../../../../database'
import { defineAiHandler } from '../../../../utils/ai-auth'
import { listTokenDealEditList } from '../../../../utils/ai-service'

export default defineAiHandler('read', async (event, token) => {
  const { id } = getRouterParams(event)
  return listTokenDealEditList(getRawDb(), token.user_id, id, getQuery(event))
})
