/**
 * PUT /api/admin/bookmarks/:id — 更新书签
 * 管理员：可更新任意书签
 * 普通用户：仅可更新自己的书签，且不能更改公开状态
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const bookmarkId = parseInt(id)
  if (isNaN(bookmarkId)) {
    throw createError({ statusCode: 400, data: { error: '无效的书签 ID' } })
  }

  const bookmark = db.prepare('SELECT id, user_id FROM bookmarks WHERE id = ?').get(bookmarkId) as any
  if (!bookmark) {
    throw createError({ statusCode: 404, data: { error: '书签不存在' } })
  }

  if (!isAdmin && bookmark.user_id !== auth.id) {
    throw createError({ statusCode: 403, data: { error: '无权限修改此书签' } })
  }

  const body = await readBody(event)
  const { title, url, folder_id, icon, login_required, label } = body

  // URL scheme 校验
  if (url !== undefined) {
    const DANGER_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:']
    const lowerUrl = url.toLowerCase().trim()
    if (DANGER_SCHEMES.some(s => lowerUrl.startsWith(s))) {
      throw createError({ statusCode: 400, data: { error: '不支持的 URL 协议' } })
    }
  }

  // 校验 folder_id 归属（防止跨用户写入）
  if (folder_id !== undefined && folder_id !== 0) {
    const folder = db.prepare('SELECT user_id FROM folders WHERE id = ?').get(folder_id) as { user_id: number } | undefined
    if (!folder) {
      throw createError({ statusCode: 400, data: { error: '目标文件夹不存在' } })
    }
    if (folder.user_id !== bookmark.user_id) {
      throw createError({ statusCode: 403, data: { error: '无权将书签移至此文件夹' } })
    }
  }

  const now = Date.now()

  // 构建动态 UPDATE，事务包裹确保原子性
  const setClauses: string[] = ['updated_at = ?']
  const params: any[] = [now]

  if (title !== undefined) { setClauses.push('title = ?'); params.push(title) }
  if (url !== undefined) { setClauses.push('url = ?'); params.push(url) }
  if (folder_id !== undefined) { setClauses.push('folder_id = ?'); params.push(folder_id !== 0 ? folder_id : null) }
  if (icon !== undefined) { setClauses.push('icon = ?'); params.push(icon) }
  if (isAdmin && login_required !== undefined) { setClauses.push('login_required = ?'); params.push(login_required ? 1 : 0) }
  // label: '' = 公共池，非空 = 个人书签
  if (label !== undefined) {
    const normalized = typeof label === 'string' ? label : ''
    setClauses.push('label = ?')
    params.push(normalized)
  }

  if (setClauses.length > 1) {
    params.push(bookmarkId)
    db.transaction(() => {
      db.prepare(`UPDATE bookmarks SET ${setClauses.join(', ')} WHERE id = ?`).run(...params)
    })()
  }

  const updated = db.prepare(`
    SELECT b.*, f.name as folder_name, u.username
    FROM bookmarks b
    LEFT JOIN folders f ON b.folder_id = f.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
  `).get(bookmarkId)

  return { bookmark: updated }
})
