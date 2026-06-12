/**
 * GET /api/admin/prompt-folders — 提示词文件夹列表
 * 所有人可见（管理员的文件夹对普通用户只读，前端控制）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const folders = isAdmin
    ? db.prepare(`
        SELECT pf.*, u.username,
          parent.name as parent_name,
          (SELECT COUNT(*) FROM prompts WHERE folder_id = pf.id) as prompt_count
        FROM prompt_folders pf
        LEFT JOIN users u ON pf.user_id = u.id
        LEFT JOIN prompt_folders parent ON pf.parent_id = parent.id
        ORDER BY pf.user_id, pf.name
      `).all()
    : db.prepare(`
        SELECT pf.*, u.username,
          parent.name as parent_name,
          (SELECT COUNT(*) FROM prompts WHERE folder_id = pf.id AND user_id = ?) as prompt_count
        FROM prompt_folders pf
        LEFT JOIN users u ON pf.user_id = u.id
        LEFT JOIN prompt_folders parent ON pf.parent_id = parent.id
        ORDER BY pf.user_id, pf.name
      `).all(user.id)

  return { folders, isAdmin }
})
