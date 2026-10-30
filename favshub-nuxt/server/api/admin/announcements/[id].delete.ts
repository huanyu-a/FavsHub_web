import { defineEventHandler, createError } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * DELETE /api/admin/announcements/:id — **软删除**公告（管理员）
 *
 * 2026-10-30：由物理删除改为软删除。理由与 `token_deals` 一致：
 * 误删是不可逆的运营事故，而软删除既能立即从前端消失，又能一键恢复；
 * 需要真正抹除时可再补一个带 `confirm` 的 purge 端点（本次不做）。
 */
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const id = Number(event.context.params?.id)
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: '无效的公告 ID' })
  }

  const db = getRawDb()
  const existing = db.prepare('SELECT id, deleted_at FROM announcements WHERE id = ?').get(id) as
    { id: number; deleted_at: number | null } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, message: '公告不存在' })
  }

  // 幂等：已删除的再删一次直接返回成功，不刷新删除时间与操作人
  if (existing.deleted_at) {
    return {
      code: 200,
      message: '公告已处于删除状态',
    }
  }

  const now = Date.now()

  try {
    db.prepare(
      'UPDATE announcements SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?'
    ).run(now, user.id, now, id)

    return {
      code: 200,
      message: '已删除公告（可在「已删除」筛选中恢复）',
    }
  } catch (err: any) {
    console.error('删除公告失败:', err)
    throw createError({ statusCode: 500, message: '删除失败: ' + (err.message || '未知错误') })
  }
})
