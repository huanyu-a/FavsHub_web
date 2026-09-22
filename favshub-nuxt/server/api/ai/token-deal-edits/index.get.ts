/**
 * GET /api/ai/token-deal-edits — 待我审核的通告修改建议（read）
 *
 * Query: limit, page
 *
 * 管理员 → 全部用户的待审建议（scope:'all'）；
 * 普通用户 → 自己发布的通告上、由**他人**提交的待审建议（scope:'own'）。
 * 排除「自己给自己的通告提的建议」—— 那类由本人直接编辑更自然。
 */
import { getQuery } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { listReviewableTokenDealEdits } from '../../../utils/ai-service'

export default defineAiHandler('read', async (event, token) => {
  return listReviewableTokenDealEdits(getRawDb(), token.user_id, getQuery(event))
})
