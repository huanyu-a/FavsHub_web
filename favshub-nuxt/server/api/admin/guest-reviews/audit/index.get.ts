/**
 * GET /api/admin/guest-reviews/audit?id=<reviewId> — 游客评测处置历史（仅管理员）
 *
 * 路径为什么是 `/audit?id=` 而不是 `/:id/audit`：`guest-reviews/[id]/` 目录已被
 * 「处置动作」占用（`[id]/action.post.ts`），若文件与目录同段并存，路由优先级
 * 容易踩坑。集中到 `/audit` 一个读取端点，语义更清楚，也不与写端点抢路径。
 *
 * Query: id（必填，评测 id）, limit（默认 20，上限 100）
 *
 * 返回：`{ success, review_id, actions, auto_refresh }`
 *   - `actions` 倒序（最新在前）：动作 / 前后状态 / 理由 / 操作人 / 时间
 *   - `auto_refresh=true` 表示本次顺带做了软删除态收敛（历史遗留「已删但 status 仍是
 *     approved」的行），调用方应重新拉列表，避免界面上计数与库内不一致
 *
 * 权限：`requireAdmin()`。审计行里只有操作人 id 与用户名（管理端内部信息），
 * 不含游客侧任何标识（指纹 / IP / QQ 密文都不落审计表）。
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'
import { ensureGuestReviewSchema, listGuestReviewAdminActions } from '../../../../utils/guest-reviews'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getRawDb()
  ensureGuestReviewSchema(db)

  const query = getQuery(event)
  const reviewId = String(query.id ?? query.review_id ?? '').trim()
  if (!reviewId) {
    throw createError({ statusCode: 400, data: { error: '缺少 id（评测 ID）' } })
  }

  const result = listGuestReviewAdminActions(db, { ...query, review_id: reviewId })
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return {
    success: true,
    review_id: reviewId,
    actions: result.data.actions,
    auto_refresh: result.data.auto_refresh,
  }
})