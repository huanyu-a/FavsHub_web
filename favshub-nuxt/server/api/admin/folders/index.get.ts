/**
 * GET /api/admin/folders — 书签文件夹列表
 * 所有用户仅返回自己的文件夹
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()

  const folders = db.prepare(`
    SELECT f.*, u.username,
      pf.name as parent_name,
      (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
    FROM folders f
    LEFT JOIN users u ON f.user_id = u.id
    LEFT JOIN folders pf ON f.parent_id = pf.id
    WHERE f.user_id = ?
    ORDER BY f.parent_id, f.sort_order
  `).all(auth.id)

  return { folders }
})
