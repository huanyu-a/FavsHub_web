/**
 * GET /api/token-deal-edits — 待我审核的修改建议
 *
 * Query: page, limit（默认 50）
 *
 * 范围：
 *   - 管理员 → 全部用户的待审提案（scope:'all'）
 *   - 普通用户 → 只包含自己发布的通告上、由**他人**提交的待审提案（scope:'own'）
 *
 * 排除「自己给自己的通告提的提案」—— 那类由本人直接编辑更自然，留在待审队列纯属噪音。
 * 仅返回 `pending`：已结案的提案在通告详情里追溯即可。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { listReviewableEdits } from '../../utils/deal-edits'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }

  const query = getQuery(event)
  const result = listReviewableEdits(getRawDb(), role, query)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    edits: result.data.edits,
    total: result.data.total,
    scope: result.data.scope,
  }
})
