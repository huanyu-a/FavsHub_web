import { defineEventHandler } from 'h3'
import { getRawDb } from '../../database'

/**
 * GET /api/friend-links — 公开友情链接列表（仅 status='active'）
 */
export default defineEventHandler(async (event) => {
  const db = getRawDb()
  try {
    const list = db.prepare(`
      SELECT id, name, url, logo, description, sort_order
      FROM friend_links
      WHERE status = 'active'
      ORDER BY sort_order ASC, id ASC
    `).all()

    return {
      code: 200,
      data: list || [],
    }
  } catch (err: any) {
    console.error('获取友情链接失败:', err)
    return {
      code: 500,
      data: [],
      error: '获取友情链接失败',
    }
  }
})
