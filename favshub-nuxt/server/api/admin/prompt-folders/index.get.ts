/**
 * GET /api/admin/prompt-folders — 提示词文件夹列表（仅管理员）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const folders = db.prepare(`
    SELECT pf.*, u.username,
      parent.name as parent_name,
      (SELECT COUNT(*) FROM prompts WHERE folder_id = pf.id) as prompt_count
    FROM prompt_folders pf
    LEFT JOIN users u ON pf.user_id = u.id
    LEFT JOIN prompt_folders parent ON pf.parent_id = parent.id
    ORDER BY pf.user_id, pf.parent_id NULLS FIRST, pf.sort_order
  `).all()

  return { folders, isAdmin: true }
})
