/**
 * GET /api/token-deals/:id/edits — 某通告的修改建议列表
 *
 * Query: status (pending|approved|rejected|all，默认全部)
 *
 * 可见性：
 *   - 通告作者 / 管理员 → 全部提案（含已结案，供审核与追溯），响应带 can_review:true
 *   - 其他登录用户     → 仅自己提交的提案
 *   - 匿名             → 仅通告公开时可用，且无自己的提案（返回空列表）
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { listDealEdits } from '../../../utils/deal-edits'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const query = getQuery(event)
  const role = getAuthRole(event)

  const result = listDealEdits(getRawDb(), role, id, query)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    edits: result.data.edits,
    can_review: result.data.can_review,
  }
})
