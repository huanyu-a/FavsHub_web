/**
 * POST /api/bookmarks — 创建书签
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { title, url, folder_id, icon, login_required } = body || {}

  if (!title || !url) {
    throw createError({ statusCode: 400, data: { error: '标题和 URL 不能为空' } })
  }
  if (title.length > 256 || url.length > 2048 || (icon && icon.length > 2048)) {
    throw createError({ statusCode: 400, data: { error: '字段长度超出限制' } })
  }

  const db = getRawDb()

  // 可见性：管理员可自由选择公开/私有；普通用户强制私有（仅自己可见）
  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const lr = (dbUser?.is_admin) ? (login_required ? 1 : 0) : 1

  const now = Date.now()
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM bookmarks WHERE user_id = ?').get(user.id) as { m: number | null } | undefined
  const result = db.prepare(
    'INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order, source, login_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(user.id, title, url, folder_id || null, icon || null, (maxOrder?.m || 0) + 1, 'web', lr, now, now)

  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(result.lastInsertRowid)
  return { bookmark }
})
