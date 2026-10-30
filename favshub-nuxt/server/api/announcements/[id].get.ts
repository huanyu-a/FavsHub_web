import { defineEventHandler, createError } from 'h3'
import { getRawDb } from '../../database'

/**
 * GET /api/announcements/:id — 公开获取某篇公告详情
 */
export default defineEventHandler(async (event) => {
  const id = Number(event.context.params?.id)
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: '无效的公告 ID' })
  }

  const db = getRawDb()

  try {
    const item = db.prepare(`
      SELECT id, title, content, content_type, pinned, created_at, updated_at
      FROM announcements
      WHERE id = ? AND status = 'published' AND deleted_at IS NULL
    `).get(id)

    if (!item) {
      throw createError({ statusCode: 404, message: '公告不存在或未发布' })
    }

    return {
      code: 200,
      data: item,
    }
  } catch (err: any) {
    if (err.statusCode) throw err
    console.error('获取公告详情失败:', err)
    throw createError({ statusCode: 500, message: '获取公告详情失败' })
  }
})
