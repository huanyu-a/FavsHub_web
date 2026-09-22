/**
 * DELETE /api/token-deal-edits/:id — 撤回自己的修改建议
 *
 * 仅提案人可撤回自己的提案（管理员可撤回任意待审提案）；只能撤回 `pending` 状态的提案。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { withdrawDealEdit } from '../../utils/deal-edits'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }

  const { id } = getRouterParams(event)

  const result = withdrawDealEdit(getRawDb(), role, id)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return { success: true, id: result.data.id }
})
