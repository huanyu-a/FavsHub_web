/**
 * POST /api/prompts/versions/:promptId — 创建提示词版本
 * Body: { content, version_number, variables, created_at }
 */
import { randomUUID } from 'node:crypto'
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { promptId } = getRouterParams(event)
  const body = await readBody(event)
  const { content, version_number, variables, created_at } = body || {}

  if (!content) {
    throw createError({ statusCode: 400, data: { error: '版本内容不能为空' } })
  }

  const db = getRawDb()

  // 验证归属
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }
  if (prompt.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权修改此提示词' } })
  }

  const id = randomUUID()
  const now = created_at || Date.now()

  db.prepare(`
    INSERT INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, promptId, content, version_number || prompt.current_version || '1.0.0', variables || '', now)

  const version = db.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(id)
  return { version }
})
