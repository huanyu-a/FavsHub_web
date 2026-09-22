/**
 * POST /api/token-deals/:id/edits — 提交修改建议
 *
 * 任何登录用户都可对**已公开**的通告提交字段级修改建议（只带要改的字段），
 * 由「通告作者」或「管理员」审核；管理员可审核所有用户的提案。
 *
 * Body: { <可改字段...>, comment?: string }
 *   可改字段：provider / title / url / call_url / quota / models[] /
 *            region / quality / source_tag / expires_at / note
 *   两种命名都接受（call_url 与 callUrl、source_tag 与 sourceTag、expires_at 与 expiresAt）
 *
 * 同一人对同一通告只保留一条待审提案 —— 再次提交会覆盖此前那条（响应 created:false）。
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { submitDealEdit } from '../../../utils/deal-edits'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }

  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const result = submitDealEdit(getRawDb(), role, id, body)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    success: true,
    created: result.data.created,
    edit: result.data.edit,
    message: result.data.message,
  }
})
