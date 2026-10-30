import { defineEventHandler } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * GET /api/admin/friend-links — 获取全部友情链接（管理员）
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  try {
    const list = db.prepare(`
      SELECT id, name, url, logo, description, sort_order, status, created_at, updated_at
      FROM friend_links
      ORDER BY sort_order ASC, id ASC
    `).all()

    return {
      code: 200,
      data: list || [],
    }
  } catch (err: any) {
    console.error('管理员获取友情链接列表失败:', err)
    return {
      code: 500,
      data: [],
      error: '获取友情链接列表失败',
    }
  }
})
