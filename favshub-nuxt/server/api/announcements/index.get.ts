import { defineEventHandler } from 'h3'
import { getRawDb } from '../../database'

/**
 * GET /api/announcements — 公开公告列表（status='published'）
 * 按置顶和创建时间倒序排列
 */
export default defineEventHandler(async (event) => {
  const db = getRawDb()

  try {
    const list = db.prepare(`
      SELECT id, title, content, content_type, pinned, created_at, updated_at
      FROM announcements
      WHERE status = 'published' AND deleted_at IS NULL
      ORDER BY pinned DESC, created_at DESC
    `).all()

    return {
      code: 200,
      data: list || [],
    }
  } catch (err: any) {
    console.error('获取公告列表失败:', err)
    return {
      code: 500,
      data: [],
      error: '获取公告列表失败',
    }
  }
})
