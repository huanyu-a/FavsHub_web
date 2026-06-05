/**
 * PUT /api/bookmarks/:id — 更新书签
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const params = getRouterParams(event)
  const body = await readBody(event)
  const { title, url, folder_id, sort_order, icon, login_required } = body || {}

  // 输入长度校验
  if (title !== undefined && title.length > 256) throw createError({ statusCode: 400, data: { error: '标题最长 256 字符' } })
  if (url !== undefined && url.length > 2048) throw createError({ statusCode: 400, data: { error: 'URL 最长 2048 字符' } })
  if (icon !== undefined && icon.length > 2048) throw createError({ statusCode: 400, data: { error: '图标 URL 最长 2048 字符' } })

  const db = getRawDb()

  // 验证书签归属
  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(params.id, user.id) as any
  if (!bookmark) {
    throw createError({ statusCode: 404, data: { error: '书签不存在' } })
  }

  const now = Date.now()

  if (title !== undefined) {
    db.prepare('UPDATE bookmarks SET title = ?, updated_at = ? WHERE id = ?').run(title, now, bookmark.id)
  }
  if (url !== undefined) {
    db.prepare('UPDATE bookmarks SET url = ?, updated_at = ? WHERE id = ?').run(url, now, bookmark.id)
  }
  if (folder_id !== undefined) {
    db.prepare('UPDATE bookmarks SET folder_id = ?, updated_at = ? WHERE id = ?').run(folder_id, now, bookmark.id)
  }
  if (sort_order !== undefined) {
    db.prepare('UPDATE bookmarks SET sort_order = ?, updated_at = ? WHERE id = ?').run(sort_order, now, bookmark.id)
  }
  if (icon !== undefined) {
    db.prepare('UPDATE bookmarks SET icon = ?, updated_at = ? WHERE id = ?').run(icon, now, bookmark.id)
  }
  // 只有管理员可修改 login_required
  if (login_required !== undefined) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser && dbUser.is_admin) {
      db.prepare('UPDATE bookmarks SET login_required = ?, updated_at = ? WHERE id = ?').run(login_required ? 1 : 0, now, bookmark.id)
    }
  }

  const updated = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(bookmark.id)
  return { bookmark: updated }
})
