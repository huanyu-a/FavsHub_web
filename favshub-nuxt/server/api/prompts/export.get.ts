/**
 * GET /api/prompts/export — 导出提示词（JSON）
 * 默认导出当前用户的提示词
 * 管理员传 ?all=1 可导出全部提示词
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()
  const query = getQuery(event)

  // 检查是否管理员导出全部
  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin
  const exportAll = isAdmin && query.all === '1'

  // 获取提示词
  const prompts = exportAll
    ? db.prepare(`
        SELECT p.*, f.name as folder_name, u.username
        FROM prompts p
        LEFT JOIN prompt_folders f ON p.folder_id = f.id
        LEFT JOIN users u ON p.user_id = u.id
        ORDER BY p.updated_at DESC
      `).all() as any[]
    : db.prepare(`
        SELECT p.*, f.name as folder_name
        FROM prompts p
        LEFT JOIN prompt_folders f ON p.folder_id = f.id
        WHERE p.user_id = ?
        ORDER BY p.updated_at DESC
      `).all(user.id) as any[]

  // 获取关联的标签
  if (prompts.length > 0) {
    const promptIds = prompts.map(p => p.id)
    const placeholders = promptIds.map(() => '?').join(',')
    const allTags = db.prepare(`
      SELECT pt.prompt_id, t.id, t.name, t.color
      FROM tags t
      JOIN prompt_tags pt ON t.id = pt.tag_id
      WHERE pt.prompt_id IN (${placeholders})
    `).all(...promptIds) as any[]

    const tagsByPromptId: Record<number, any[]> = {}
    for (const tag of allTags) {
      if (!tagsByPromptId[tag.prompt_id]) tagsByPromptId[tag.prompt_id] = []
      tagsByPromptId[tag.prompt_id].push({ id: tag.id, name: tag.name, color: tag.color })
    }
    for (const p of prompts) { p.tags = tagsByPromptId[p.id] || [] }
  } else {
    for (const p of prompts) { p.tags = [] }
  }

  // 获取文件夹
  const folders = exportAll
    ? db.prepare(`SELECT * FROM prompt_folders ORDER BY name`).all()
    : db.prepare(`SELECT * FROM prompt_folders WHERE user_id = ? ORDER BY name`).all(user.id)

  const exportData = {
    exported_at: new Date().toISOString(),
    export_type: exportAll ? 'all' : 'user',
    total_prompts: prompts.length,
    total_folders: folders.length,
    folders,
    prompts: prompts.map(p => ({
      title: p.title,
      description: p.description,
      content: p.content,
      folder_name: p.folder_name,
      tags: p.tags,
      is_favorite: p.is_favorite,
      current_version: p.current_version,
      created_at: p.created_at,
      updated_at: p.updated_at,
      ...(exportAll ? { username: p.username } : {}),
    })),
  }

  const json = JSON.stringify(exportData, null, 2)

  setResponseHeaders(event, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="favshub-prompts-${exportAll ? 'all-' : ''}${Date.now()}.json"`,
  })

  return json
})
