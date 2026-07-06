/**
 * GET /api/admin/prompts — 管理后台提示词列表
 * 管理员：全部
 * 普通用户：仅自己的
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

	  const prompts = isAdmin
	    ? db.prepare(`
	        SELECT p.*, u.username, pf.name as folder_name, u.is_admin as owner_is_admin
	        FROM prompts p LEFT JOIN users u ON p.user_id = u.id
	        LEFT JOIN prompt_folders pf ON p.folder_id = pf.id
	        ORDER BY p.updated_at DESC
	      `).all() as any[]
	    : db.prepare(`
	        SELECT p.*, u.username, pf.name as folder_name, u.is_admin as owner_is_admin
	        FROM prompts p LEFT JOIN users u ON p.user_id = u.id
	        LEFT JOIN prompt_folders pf ON p.folder_id = pf.id
	        WHERE p.user_id = ? OR p.login_required = 0
	        ORDER BY p.updated_at DESC
	      `).all(user.id) as any[]

  // 附加标签
  if (prompts.length > 0) {
    const promptIds = prompts.map(p => p.id)
    const placeholders = promptIds.map(() => '?').join(',')
    const allTags = db.prepare(`
      SELECT pt.prompt_id, t.name FROM tags t
      JOIN prompt_tags pt ON t.id = pt.tag_id
      WHERE pt.prompt_id IN (${placeholders})
    `).all(...promptIds) as any[]

    const tagsByPromptId: Record<number, string[]> = {}
    for (const tag of allTags) {
      if (!tagsByPromptId[tag.prompt_id]) tagsByPromptId[tag.prompt_id] = []
      tagsByPromptId[tag.prompt_id].push(tag.name)
    }
    for (const p of prompts) { p.tags = tagsByPromptId[p.id] || [] }
  } else {
    for (const p of prompts) { p.tags = [] }
  }

  return { prompts, isAdmin }
})
