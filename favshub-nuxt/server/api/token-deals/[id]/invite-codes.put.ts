/**
 * PUT /api/token-deals/:id/invite-codes — **全量替换**码池（仅作者 / 管理员）
 *
 * Body: `{ codes: [{ code, label?, weight?, copyLimit?, enabled? }] }`
 *
 * ## 为什么是「全量替换」而不是增删改三个端点
 *
 * 码池是**一个整体**（一个通告的码集合），编辑器天然持有完整列表，
 * 提交即终态。逐个增删改需要 diff 协议，还要处理「删除后再插入」的中途失败，
 * 而全量替换在单个事务里完成，不存在半截码池。
 *
 * ## copy_count 会被保留
 *
 * 替换时按**码内容**匹配已有记录沿用 `copy_count`（见 `replaceInviteCodes`）。
 * 否则每次编辑通告都会把复制计数清零，已经用满的码会重新开始出现。
 *
 * ## 与 AI 通道的关系
 *
 * 码池不参与 `DEAL_PATCHABLE`：AI 令牌（`/api/ai/*`、`/api/mcp`）目前不提供
 * 邀请码读写能力，这是有意的 —— 邀请码属于分发控制信息，走人工界面更可控。
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import {
  findManageableDeal,
  validateInviteCodes,
  replaceInviteCodes,
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

  const body = await readBody(event).catch(() => ({} as any))
  // 显式要求 codes 字段：避免调用方漏传时被静默当成「清空码池」
  if (!body || body.codes === undefined || body.codes === null) {
    throw createError({ statusCode: 400, data: { error: '缺少 codes 字段（清空请显式传空数组）' } })
  }

  const parsed = validateInviteCodes(body.codes)
  if (!parsed.ok) {
    throw createError({ statusCode: 400, data: { error: parsed.error } })
  }

  replaceInviteCodes(db, dealId, parsed.codes)

  const stats = countInviteCodes(db, dealId)

  return {
    code: 200,
    data: { saved: parsed.codes.length, total: stats.total, available: stats.available },
    message: '邀请码已保存',
  }
})
