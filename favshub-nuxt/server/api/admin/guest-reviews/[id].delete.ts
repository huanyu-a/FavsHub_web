/**
 * DELETE /api/admin/guest-reviews/:id — 管理员**软删除**一条游客评测
 *
 * Query: reason（可选，≤200 字，写进删除原因与审计）
 * Body:  { reason?: string } —— 也接受（curl / 前端都方便）
 *
 * 语义（与 `adminActOnGuestReview(action:'delete')` 同一个实现）：
 *   1. `deleted_at / deleted_by / deleted_status` 落库，`status` 降为 `rejected`
 *      —— 行**不出库**，公开侧（仅 approved）立即不可见，评分计数随之重算
 *   2. 处置动作写审计（谁 / 何时 / 对哪条 / 前后状态 / 理由）
 *   3. 幂等：对已删除的评测再次 DELETE 返回 200「此前已被删除」，不报错
 *
 * 权限：`requireAdmin()`（未登录 401 / 非管理员 403）。
 * 响应经 `serializeGuestReviewForAdmin()` 白名单输出，不含指纹 / IP / QQ 密文 / 内部 user id。
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { adminActOnGuestReview } from '../../../utils/guest-reviews'

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const { id } = getRouterParams(event)

  const query = getQuery(event)
  let bodyReason = ''
  // 删除请求通常不带 body；带了就以 body 为准（readBody 对无 body 的 DELETE 返回 undefined）
  try {
    const body = await readBody(event).catch(() => null)
    if (body && typeof body === 'object') bodyReason = String((body as any).reason || '')
  } catch { /* 无 body 或非法 JSON：按未填写理由处理 */ }

  const reason = String(bodyReason || query.reason || '').trim().slice(0, 200)

  const result = adminActOnGuestReview(getRawDb(), admin, id, { action: 'delete', reason })
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    success: true,
    action: 'delete',
    review: result.data.review,
    message: result.data.message,
  }
})