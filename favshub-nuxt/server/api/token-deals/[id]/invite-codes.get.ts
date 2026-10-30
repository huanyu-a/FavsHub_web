/**
 * GET /api/token-deals/:id/invite-codes — 读取**完整**码池（仅作者 / 管理员）
 *
 * 公开侧永不调用此端点（也没有权限）：公开只能通过 `GET /:id/invite-code`
 * 拿到被抽中的那一个。这里是编辑器回填与后台审计用的完整视图，附带
 * `copy_count` / `exhausted` 以便一眼看出哪个码已经用满。
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import {
  findManageableDeal,
  listInviteCodes,
  countInviteCodes,
} from '../../../utils/invite-codes'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const dealId = String(id)

  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '请先登录' } })
  }

  const db = getRawDb()
  const gate = findManageableDeal(db, dealId, { id: role.user.id, isAdmin: role.isAdmin })
  if (!gate.ok) {
    throw createError({ statusCode: gate.status, data: { error: gate.error } })
  }

  const rows = listInviteCodes(db, dealId)
  const stats = countInviteCodes(db, dealId)

  return {
    code: 200,
    data: {
      codes: rows.map(r => {
        const limit = Number(r.copy_limit) || 0
        const count = Number(r.copy_count) || 0
        return {
          id: r.id,
          code: r.code,
          label: r.label || '',
          weight: Number(r.weight) > 0 ? Number(r.weight) : 1,
          copy_limit: limit,
          copy_count: count,
          enabled: !!r.enabled,
          /** 已达复制上限 → 前端标「已用满」，不会再出现给访客 */
          exhausted: limit > 0 && count >= limit,
        }
      }),
      total: stats.total,
      available: stats.available,
    },
  }
})
