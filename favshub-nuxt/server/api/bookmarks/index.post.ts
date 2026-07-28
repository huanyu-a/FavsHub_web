/**
 * POST /api/bookmarks — 创建书签
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { normalizeUrl } from '../../utils/bookmark-labels'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { title, url, folder_id, icon, login_required, label, description, need_proxy } = body || {}

  if (!title || !url) {
    throw createError({ statusCode: 400, data: { error: '标题和 URL 不能为空' } })
  }
  // URL 归一化：去掉结尾斜杠，避免仅尾 / 差异产生重复
  const normalizedUrl = normalizeUrl(url)
  if (title.length > 256 || url.length > 2048 || (icon && icon.length > 2048)) {
    throw createError({ statusCode: 400, data: { error: '字段长度超出限制' } })
  }

  // 校验 URL scheme（拒绝危险协议，防止存储型 XSS）
  const DANGER_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:']
  const lowerUrl = url.toLowerCase().trim()
  if (DANGER_SCHEMES.some(s => lowerUrl.startsWith(s))) {
    throw createError({ statusCode: 400, data: { error: `不支持的 URL 协议` } })
  }

  const db = getRawDb()

  // 校验 folder_id 归属（防止跨用户写入）
  if (folder_id != null) {
    const folder = db.prepare('SELECT user_id FROM folders WHERE id = ?').get(folder_id) as { user_id: number } | undefined
    if (!folder) {
      throw createError({ statusCode: 400, data: { error: '目标文件夹不存在' } })
    }
    if (folder.user_id !== user.id) {
      throw createError({ statusCode: 403, data: { error: '无权写入此文件夹' } })
    }
  }

  // 可见性：管理员可自由选择公开/私有；普通用户强制私有（仅自己可见）
  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const lr = (dbUser?.is_admin) ? (login_required ? 1 : 0) : 1
  // 个人空间创建的书签默认 label 非空；管理员可显式传 label:'' 写入公共池
  const bmLabel = typeof label === 'string' ? label : 'web'

  const now = Date.now()
  // 事务包裹 MAX + INSERT，防止并发竞态产生重复 sort_order
  const insertStmt = db.prepare(
    'INSERT INTO bookmarks (user_id, title, url, folder_id, icon, description, sort_order, source, login_required, label, need_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  let result: { lastInsertRowid: number | bigint }
  try {
    result = db.transaction(() => {
      const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM bookmarks WHERE user_id = ?').get(user.id) as { m: number | null } | undefined
      return insertStmt.run(user.id, title, normalizedUrl, folder_id || null, icon || null, description || '', (maxOrder?.m || 0) + 1, 'web', lr, bmLabel, need_proxy ? 1 : 0, now, now)
    })()
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) {
      throw createError({ statusCode: 409, data: { error: '该 URL 的书签已存在' } })
    }
    throw err
  }

  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(result.lastInsertRowid)
  return { bookmark }
})
