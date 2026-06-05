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

  const db = getRawDb()
  const id = randomUUID()
  const now = Date.now()

  // 创建 prompt
  db.prepare(`
    INSERT INTO prompts (id, user_id, title, description, content, folder_id, login_required, version_count, current_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, '1.0.0', ?, ?)
  `).run(id, user.id, title, description || '', content, folder_id || null, login_required ? 1 : 0, now, now)

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
