/**
 * POST /api/prompts — 创建提示词
 * Body: { title, description, content, folder_id, tags, login_required }
 */
import { randomUUID } from 'node:crypto'
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { title, description, content, folder_id, tags, login_required } = body || {}

  if (!title || !content) {
    throw createError({ statusCode: 400, data: { error: '标题和内容不能为空' } })
  }
  if (title.length > 256) throw createError({ statusCode: 400, data: { error: '标题最长 256 字符' } })
  if (description && description.length > 2000) throw createError({ statusCode: 400, data: { error: '描述最长 2000 字符' } })
  if (content.length > 100000) throw createError({ statusCode: 400, data: { error: '内容最长 100000 字符' } })

  const db = getRawDb()
  const id = randomUUID()
  const now = Date.now()

  // 可见性：管理员可自由选择公开/私有；普通用户强制私有（仅自己可见）
  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const lr = (dbUser?.is_admin) ? (login_required ? 1 : 0) : 1

  // 创建 prompt
  db.prepare(`
    INSERT INTO prompts (id, user_id, title, description, content, folder_id, login_required, version_count, current_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, '1.0.0', ?, ?)
  `).run(id, user.id, title, description || '', content, folder_id || null, lr, now, now)

  // 创建初始版本
  const versionId = randomUUID()
  db.prepare(`
    INSERT INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at)
    VALUES (?, ?, ?, '1.0.0', '', ?)
  `).run(versionId, id, content, now)

  // 关联标签
  if (Array.isArray(tags) && tags.length > 0) {
    const stmt = db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)')
    for (const tagId of tags) {
      stmt.run(id, tagId, now)
    }
  }

  // 返回创建的 prompt（含标签）
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  const promptTags = db.prepare(`
    SELECT t.id, t.name, t.color FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = ?
  `).all(id)
  prompt.prompt_id = prompt.id
  prompt.tags = promptTags

  return { prompt }
})
