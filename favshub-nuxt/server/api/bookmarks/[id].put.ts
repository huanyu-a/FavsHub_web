/**
 * PUT /api/bookmarks/:id — 更新书签
 * 使用事务包裹所有 UPDATE，确保原子性
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const params = getRouterParams(event)
  const body = await readBody(event)
  const { title, url, folder_id, sort_order, icon, login_required, label } = body || {}

  // 输入长度校验
  if (title !== undefined && title.length > 256) throw createError({ statusCode: 400, data: { error: '标题最长 256 字符' } })
  if (url !== undefined && url.length > 2048) throw createError({ statusCode: 400, data: { error: 'URL 最长 2048 字符' } })
  if (icon !== undefined && icon.length > 2048) throw createError({ statusCode: 400, data: { error: '图标 URL 最长 2048 字符' } })

  // 校验 URL scheme（拒绝危险协议，防止存储型 XSS）
  if (url !== undefined) {
    const DANGER_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:']
    const lowerUrl = url.toLowerCase().trim()
    if (DANGER_SCHEMES.some(s => lowerUrl.startsWith(s))) {
      throw createError({ statusCode: 400, data: { error: `不支持的 URL 协议` } })
    }
  }

  const db = getRawDb()

  // 验证书签归属
  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(params.id, user.id) as any
  if (!bookmark) {
    throw createError({ statusCode: 404, data: { error: '书签不存在' } })
  }

  // 校验 folder_id 归属（防止跨用户写入）
  if (folder_id !== undefined) {
    const folder = db.prepare('SELECT user_id FROM folders WHERE id = ?').get(folder_id) as { user_id: number } | undefined
    if (!folder) {
      throw createError({ statusCode: 400, data: { error: '目标文件夹不存在' } })
    }
    if (folder.user_id !== user.id) {
      throw createError({ statusCode: 403, data: { error: '无权写入此文件夹' } })
    }
  }

  // 可见性：管理员可自由选择，普通用户强制私有（仅自己可见）
  let lr: number | undefined
  if (login_required !== undefined) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    lr = (dbUser?.is_admin) ? (login_required ? 1 : 0) : 1
  }

  const now = Date.now()

  // 构建动态 UPDATE 语句，事务包裹确保原子性
  const setClauses: string[] = ['updated_at = ?']
  const paramsArr: any[] = [now]

  if (title !== undefined) { setClauses.push('title = ?'); paramsArr.push(title) }
  if (url !== undefined) { setClauses.push('url = ?'); paramsArr.push(url) }
  if (folder_id !== undefined) { setClauses.push('folder_id = ?'); paramsArr.push(folder_id) }
  if (sort_order !== undefined) { setClauses.push('sort_order = ?'); paramsArr.push(sort_order) }
  if (icon !== undefined) { setClauses.push('icon = ?'); paramsArr.push(icon) }
  if (lr !== undefined) { setClauses.push('login_required = ?'); paramsArr.push(lr) }
  // label: '' = 公共池，非空 = 个人书签（个人空间更新默认不降级为公共池，仅显式传入时修改）
  if (label !== undefined) {
    setClauses.push('label = ?')
    paramsArr.push(typeof label === 'string' ? label : '')
  }

  if (setClauses.length > 1) {
    paramsArr.push(bookmark.id)
    db.transaction(() => {
      db.prepare(`UPDATE bookmarks SET ${setClauses.join(', ')} WHERE id = ?`).run(...paramsArr)
    })()
  }

  const updated = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(bookmark.id)
  return { bookmark: updated }
})
