/**
 * GET /api/admin/prompt-folders — 获取所有提示词文件夹（管理员视图）
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const folders = db.prepare(`
    SELECT pf.*, u.username,
      (SELECT COUNT(*) FROM prompts WHERE folder_id = pf.id) as prompt_count
    FROM prompt_folders pf
    LEFT JOIN users u ON pf.user_id = u.id
    ORDER BY pf.user_id, pf.name
  `).all()

  return { folders }
})
