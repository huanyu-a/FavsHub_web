/**
 * POST /api/prompts/:id/restore — 恢复到指定版本
 * Body: { version_id }
 */
import { randomUUID } from 'node:crypto'
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)
  const { version_id } = body || {}

  if (!version_id) {
    throw createError({ statusCode: 400, data: { error: '必须指定 version_id' } })
  }

  const db = getRawDb()

  // 验证归属
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }
  if (prompt.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '无权修改此提示词' } })
  }

  // 获取目标版本
  const version = db.prepare('SELECT * FROM prompt_versions WHERE id = ? AND prompt_id = ?').get(version_id, id) as any
  if (!version) {
    throw createError({ statusCode: 404, data: { error: '版本不存在' } })
  }

  const now = Date.now()
  const versionNum = (prompt.version_count || 0) + 1

  // 创建新版本（以恢复的内容）
  const newVersionId = randomUUID()
  db.prepare(`
    INSERT INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at)
    VALUES (?, ?, ?, ?, '', ?)
  `).run(newVersionId, id, version.content, `${versionNum}.0`, now)

  // 更新 prompt 内容和版本号
  db.prepare(`
    UPDATE prompts SET content = ?, version_count = ?, current_version = ?, updated_at = ? WHERE id = ?
  `).run(version.content, versionNum, `${versionNum}.0`, now, id)

  // 返回更新后的 prompt
  const updated = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  const tags = db.prepare(`
    SELECT t.id, t.name, t.color FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = ?
  `).all(id)
  updated.prompt_id = updated.id
  updated.tags = tags

  return { prompt: updated }
})
