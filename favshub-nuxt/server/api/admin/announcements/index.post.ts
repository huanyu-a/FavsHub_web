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
  // 2026-10-30：状态收敛为 published（发布）/ pending（待发布）；删除是软删除列，不在这里
  // 缺省/非法值取 **pending**（fail-closed）：与 PUT 端点、以及迁移里
  // 「draft/offline → pending」的收敛方向保持一致，不给「参数写错就直接对外发布」留口子
  const status = ['published', 'pending'].includes(body.status) ? body.status : 'pending'
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
