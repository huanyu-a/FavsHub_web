/**
 * GET /api/admin/guest-reviews — 管理端游客评测列表（仅管理员）
 *
 * Query:
 *   page     页码（默认 1）
 *   limit    每页条数（默认 20，上限 100）
 *   status   all | pending | approved | rejected | deleted（默认 all；`state` 同义）
 *   deal_id  只看某条通告上的评测（`deal` 同义）
 *   keyword  关键字：评测内容 / 游客展示名 / 通告 id / 评测 id（`q` 同义）
 *
 * 返回：`{ success, reviews, total, page, limit, counts, scope, pending_total }`
 *
 * 权限：`requireAdmin()`（未登录 401 / 非管理员 403）。
 *
 * **脱敏**：响应里每个评测都经 `serializeGuestReviewForAdmin()` 白名单输出，
 * 只有 `id / deal_id / nickname / rating / content / status / display_status /
 * is_user / avatar / reject_reason / deleted_at / deleted_by / created_at / updated_at`
 * 与所属通告的公开字段。`fingerprint`、`ip_hash`、`qq_cipher`、`user_id` **永不出现**
 * —— `SELECT g.*` 查出来是为了判状态与取头像密文，出口处逐个字段列举，不靠 delete 兜底。
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { ensureGuestReviewSchema, listGuestReviewsForAdmin } from '../../../utils/guest-reviews'

export default defineEventHandler((event) => {
  const admin = requireAdmin(event)
  const db = getRawDb()
  ensureGuestReviewSchema(db)

  const query = getQuery(event)
  const result = listGuestReviewsForAdmin(db, query)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  const counts = result.data.counts || {}
  return {
    success: true,
    reviews: result.data.reviews,
    total: result.data.total,
    page: result.data.page,
    limit: result.data.limit,
    counts,
    /** 待审总数（全局，不受当前筛选影响）—— 供导航角标使用 */
    pending_total: counts.pending || 0,
    scope: 'all',
    /** 操作者：便于前端在处置弹窗里显示「以谁的身份处置」 */
    admin: { id: admin.id, username: admin.username },
  }
})