/**
 * GET /api/admin/prompts — 管理后台提示词列表
 * 所有用户仅返回自己的提示词
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()

  const prompts = db.prepare(`
    SELECT p.*, u.username, pf.name as folder_name
    FROM prompts p LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN prompt_folders pf ON p.folder_id = pf.id
    WHERE p.user_id = ?
    ORDER BY p.updated_at DESC
  `).all(auth.id) as any[]

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

  return { prompts }
})
