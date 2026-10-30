import { defineEventHandler, readBody, createError } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * POST /api/admin/friend-links — 添加友情链接（管理员）
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody(event)

  const name = String(body.name || '').trim()
  const url = String(body.url || '').trim()
  const logo = String(body.logo || '').trim()
  const description = String(body.description || '').trim()
  const sortOrder = Number(body.sort_order ?? 0)
  const status = body.status === 'hidden' ? 'hidden' : 'active'

  if (!name) {
    throw createError({ statusCode: 400, message: '请填写友链名称' })
  }
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    throw createError({ statusCode: 400, message: '请填写合法的网址（http:// 或 https:// 开头）' })
  }

  const db = getRawDb()
  const now = Date.now()

  try {
    const res = db.prepare(`
      INSERT INTO friend_links (name, url, logo, description, sort_order, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, url, logo, description, sortOrder, status, now, now)

    const created = db.prepare('SELECT * FROM friend_links WHERE id = ?').get(res.lastInsertRowid)

    return {
      code: 200,
      data: created,
      message: '添加成功',
    }
  } catch (err: any) {
    console.error('添加友情链接失败:', err)
    throw createError({ statusCode: 500, message: '添加友情链接失败: ' + (err.message || '未知错误') })
  }
})
