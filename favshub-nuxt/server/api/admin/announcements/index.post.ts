import { defineEventHandler, readBody, createError } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * POST /api/admin/announcements — 发布/创建新公告（管理员）
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody(event)

  const title = String(body.title || '').trim()
  const content = String(body.content || '').trim()
  const contentType = body.content_type === 'html' ? 'html' : 'markdown'
  const status = ['published', 'draft', 'offline'].includes(body.status) ? body.status : 'published'
  const pinned = body.pinned ? 1 : 0

  if (!title) {
    throw createError({ statusCode: 400, message: '请填写公告标题' })
  }
  if (!content) {
    throw createError({ statusCode: 400, message: '请填写公告内容' })
  }

  const db = getRawDb()
  const now = Date.now()

  try {
    const res = db.prepare(`
      INSERT INTO announcements (title, content, content_type, status, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title, content, contentType, status, pinned, now, now)

    const created = db.prepare('SELECT * FROM announcements WHERE id = ?').get(res.lastInsertRowid)

    return {
      code: 200,
      data: created,
      message: '创建公告成功',
    }
  } catch (err: any) {
    console.error('创建公告失败:', err)
    throw createError({ statusCode: 500, message: '创建公告失败: ' + (err.message || '未知错误') })
  }
})
