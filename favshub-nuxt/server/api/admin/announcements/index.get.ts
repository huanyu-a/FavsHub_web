import { defineEventHandler, getQuery } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * GET /api/admin/announcements — 获取全部公告（管理员）
 *
 * Query: status = published | pending | deleted（省略 = 全部）
 * 2026-10-30：删除改为**软删除**，后台默认要能看到已删除项（供恢复），
 * 因此不再像公开接口那样过滤掉它们，而是把它们排在列表末尾。
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()
  const query = getQuery(event)
  const status = String(query.status || '')

  try {
    let where = ''
    const params: any[] = []
    if (status === 'deleted') {
      where = 'WHERE deleted_at IS NOT NULL'
    } else if (status === 'published' || status === 'pending') {
      where = 'WHERE deleted_at IS NULL AND status = ?'
      params.push(status)
    }

    const list = db.prepare(`
      SELECT id, title, content, content_type, status, pinned,
             deleted_at, deleted_by, created_at, updated_at
      FROM announcements
      ${where}
      ORDER BY (deleted_at IS NOT NULL) ASC, pinned DESC, created_at DESC
    `).all(...params)

    return {
      code: 200,
      data: list || [],
    }
  } catch (err: any) {
    console.error('管理员获取公告列表失败:', err)
    return {
      code: 500,
      data: [],
      error: '获取公告列表失败',
    }
  }
})
