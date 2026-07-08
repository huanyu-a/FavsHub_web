/**
 * GET /api/admin/prompt-folders — 提示词文件夹列表
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
    SELECT pf.*, u.username,
      parent.name as parent_name,
      (SELECT COUNT(*) FROM prompts WHERE folder_id = pf.id) as prompt_count
    FROM prompt_folders pf
    LEFT JOIN users u ON pf.user_id = u.id
    LEFT JOIN prompt_folders parent ON pf.parent_id = parent.id
    WHERE pf.user_id = ?
    ORDER BY pf.parent_id NULLS FIRST, pf.sort_order
  `).all(auth.id)

  return { folders }
})
