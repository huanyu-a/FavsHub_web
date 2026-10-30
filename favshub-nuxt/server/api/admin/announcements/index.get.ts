import { defineEventHandler } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * GET /api/admin/announcements — 获取全部公告（管理员）
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  try {
    const list = db.prepare(`
      SELECT id, title, content, content_type, status, pinned, created_at, updated_at
      FROM announcements
      ORDER BY pinned DESC, created_at DESC
    `).all()

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
