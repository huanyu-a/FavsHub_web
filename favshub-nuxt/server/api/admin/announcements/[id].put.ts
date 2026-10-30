import { defineEventHandler, readBody, createError } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * PUT /api/admin/announcements/:id — 更新公告（管理员）
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(event.context.params?.id)
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: '无效的公告 ID' })
  }

  const body = await readBody(event)
  const db = getRawDb()

  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as any
  if (!existing) {
    throw createError({ statusCode: 404, message: '公告不存在' })
  }

  const title = body.title !== undefined ? String(body.title).trim() : existing.title
  const content = body.content !== undefined ? String(body.content).trim() : existing.content
  const contentType = body.content_type !== undefined
    ? (body.content_type === 'html' ? 'html' : 'markdown')
    : existing.content_type
  const status = body.status !== undefined
    ? (['published', 'draft', 'offline'].includes(body.status) ? body.status : 'published')
    : existing.status
  const pinned = body.pinned !== undefined ? (body.pinned ? 1 : 0) : existing.pinned

  if (!title) {
    throw createError({ statusCode: 400, message: '请填写公告标题' })
  }
  if (!content) {
    throw createError({ statusCode: 400, message: '请填写公告内容' })
  }

  const now = Date.now()

  try {
    db.prepare(`
      UPDATE announcements
      SET title = ?, content = ?, content_type = ?, status = ?, pinned = ?, updated_at = ?
      WHERE id = ?
    `).run(title, content, contentType, status, pinned, now, id)

    const updated = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id)

    return {
      code: 200,
      data: updated,
      message: '更新公告成功',
    }
  } catch (err: any) {
    console.error('更新公告失败:', err)
    throw createError({ statusCode: 500, message: '更新公告失败: ' + (err.message || '未知错误') })
  }
})
