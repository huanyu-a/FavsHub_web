import { defineEventHandler, readBody, createError } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * PUT /api/admin/friend-links/:id — 更新友情链接（管理员）
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(event.context.params?.id)
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: '无效的友链 ID' })
  }

  const body = await readBody(event)
  const db = getRawDb()

  const existing = db.prepare('SELECT * FROM friend_links WHERE id = ?').get(id) as any
  if (!existing) {
    throw createError({ statusCode: 404, message: '友链不存在' })
  }

  const name = body.name !== undefined ? String(body.name).trim() : existing.name
  const url = body.url !== undefined ? String(body.url).trim() : existing.url
  const logo = body.logo !== undefined ? String(body.logo).trim() : existing.logo
  const description = body.description !== undefined ? String(body.description).trim() : existing.description
  const sortOrder = body.sort_order !== undefined ? Number(body.sort_order) : existing.sort_order
  const status = body.status !== undefined ? (body.status === 'hidden' ? 'hidden' : 'active') : existing.status

  if (!name) {
    throw createError({ statusCode: 400, message: '请填写友链名称' })
  }
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    throw createError({ statusCode: 400, message: '请填写合法的网址（http:// 或 https:// 开头）' })
  }

  const now = Date.now()

  try {
    db.prepare(`
      UPDATE friend_links
      SET name = ?, url = ?, logo = ?, description = ?, sort_order = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(name, url, logo, description, sortOrder, status, now, id)

    const updated = db.prepare('SELECT * FROM friend_links WHERE id = ?').get(id)

    return {
      code: 200,
      data: updated,
      message: '更新成功',
    }
  } catch (err: any) {
    console.error('更新友情链接失败:', err)
    throw createError({ statusCode: 500, message: '更新友情链接失败: ' + (err.message || '未知错误') })
  }
})
