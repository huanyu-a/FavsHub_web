import { defineEventHandler, readBody, createError } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * 公告状态白名单（2026-10-30）
 *
 * `published` = 发布（前端可见）、`pending` = 待发布（仅后台可见）。
 * 「删除」**不是状态**，而是独立的软删除列 `deleted_at`——这样「删掉一个待发布草稿」
 * 与「把已发布公告下架」不会互相覆盖语义。
 */
const ANNOUNCE_STATUSES = ['published', 'pending']

/**
 * PUT /api/admin/announcements/:id — 更新公告（管理员）
 *
 * 2026-10-30：状态收敛为 published / pending；新增 `restore:true` 用于撤销软删除。
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
    ? (ANNOUNCE_STATUSES.includes(String(body.status)) ? String(body.status) : 'pending')
    : existing.status
  const pinned = body.pinned !== undefined ? (body.pinned ? 1 : 0) : existing.pinned
  /** 恢复软删除：必须显式传 `restore: true`，避免普通编辑动作意外把已删公告复活 */
  const restore = body.restore === true

  if (!title) {
    throw createError({ statusCode: 400, message: '请填写公告标题' })
  }
  if (!content) {
    throw createError({ statusCode: 400, message: '请填写公告内容' })
  }

  const now = Date.now()

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE announcements
        SET title = ?, content = ?, content_type = ?, status = ?, pinned = ?, updated_at = ?
        WHERE id = ?
      `).run(title, content, contentType, status, pinned, now, id)

      if (restore) {
        db.prepare('UPDATE announcements SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?')
          .run(now, id)
      }
    })()

    const updated = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id)

    return {
      code: 200,
      data: updated,
      message: restore ? '已恢复公告' : '更新公告成功',
    }
  } catch (err: any) {
    console.error('更新公告失败:', err)
    throw createError({ statusCode: 500, message: '更新公告失败: ' + (err.message || '未知错误') })
  }
})
