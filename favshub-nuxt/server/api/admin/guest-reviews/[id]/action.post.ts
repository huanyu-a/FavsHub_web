/**
 * POST /api/admin/guest-reviews/:id/action — 管理员处置游客评测
 *
 * Body: { action: 'approve' | 'reject' | 'delete' | 'restore', reason?: string }
 *
 * 为什么单独开这个端点：既有的 `POST /api/guest-reviews/:id/review` 授权口径是
 * 「通告作者**或**管理员」（`canReviewDeal`），且只有 approve/reject 两态。
 * 管理端要求的是「仅管理员、四态俱全（含软删除与恢复）」，口径不同，不能复用
 * —— 复用就得在那个端点里按 isAdmin 分支，反而更容易出现「作者也能删」的漏洞。
 *
 * 权限：`requireAdmin()`（未登录 401 / 非管理员 403）。
 * 状态冲突（对非 pending 的评测再 approve/reject）返回 409；
 * 删除 / 恢复是幂等的（重复调用返回 200，不报错），前端连点安全。
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'
import { adminActOnGuestReview } from '../../../../utils/guest-reviews'

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const result = adminActOnGuestReview(getRawDb(), admin, id, body)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    success: true,
    action: result.data.action,
    review: result.data.review,
    message: result.data.message,
  }
})