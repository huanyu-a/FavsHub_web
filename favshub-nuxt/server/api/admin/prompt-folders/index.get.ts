/**
 * GET /api/admin/prompt-folders — 提示词文件夹列表
 * 管理员：返回全部文件夹
 * 普通用户：仅返回自己的文件夹
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  let folders: any[]
  if (isAdmin) {
    folders = db.prepare(`
      SELECT pf.*, u.username,
        parent.name as parent_name,
        (SELECT COUNT(*) FROM prompts WHERE folder_id = pf.id) as prompt_count
      FROM prompt_folders pf
      LEFT JOIN users u ON pf.user_id = u.id
      LEFT JOIN prompt_folders parent ON pf.parent_id = parent.id
      ORDER BY pf.user_id, pf.parent_id NULLS FIRST, pf.sort_order
    `).all()
  } else {
    folders = db.prepare(`
      SELECT pf.*, u.username,
        parent.name as parent_name,
        (SELECT COUNT(*) FROM prompts WHERE folder_id = pf.id) as prompt_count
      FROM prompt_folders pf
      LEFT JOIN users u ON pf.user_id = u.id
      LEFT JOIN prompt_folders parent ON pf.parent_id = parent.id
      WHERE pf.user_id = ?
      ORDER BY pf.parent_id NULLS FIRST, pf.sort_order
    `).all(auth.id)
  }

  return { folders, isAdmin }
})
