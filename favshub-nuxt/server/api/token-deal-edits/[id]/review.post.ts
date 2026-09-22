/**
 * POST /api/token-deal-edits/:id/review — 审核修改建议
 *
 * 权限：**通告作者** 或 **管理员**（管理员可审核所有用户的提案）。他人一律 404。
 *
 * Body: { action: 'approve' | 'reject', reason?: string }
 *
 * 通过时以「当前库中内容」为底合并提案 patch 后整体校验并落库；
 * 若该通告原本是 `rejected`（已被驳回），通过后回到 `pending` 交管理员过目 ——
 * 否则这次通过不会有任何可见效果。
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { reviewDealEdit } from '../../../utils/deal-edits'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }

  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const result = reviewDealEdit(getRawDb(), role, id, body)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    success: true,
    edit: result.data.edit,
    deal_status: result.data.deal_status,
    message: result.data.message,
  }
})
