/**
 * POST /api/admin/prompts/review-requests/:id/approve — 审核通过
 * 将审核请求的修改应用到原提示词
 */
import { getRawDb } from '../../../../../database'
import { requireAdmin } from '../../../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  if (!id) throw createError({ statusCode: 400, data: { error: '无效的审核 ID' } })

  const request = db.prepare('SELECT * FROM prompt_review_requests WHERE id = ?').get(id) as any
  if (!request) throw createError({ statusCode: 404, data: { error: '审核请求不存在' } })
  if (request.status !== 'pending') throw createError({ statusCode: 400, data: { error: '该请求已被处理' } })

  const now = Date.now()

  // 应用修改到原 prompt
  db.prepare(`UPDATE prompts SET title = ?, description = ?, content = ?, updated_at = ? WHERE id = ?`).run(
    request.title, request.description, request.content, now, request.prompt_id
  )

  // 创建新版本
  const prompt = db.prepare('SELECT version_count FROM prompts WHERE id = ?').get(request.prompt_id) as any
  const versionNum = (prompt?.version_count || 0) + 1
  const versionId = `${now}_v${versionNum}`
  db.prepare(`
    INSERT INTO prompt_versions (id, prompt_id, content, version_number, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(versionId, request.prompt_id, request.content, `${versionNum}.0`, now)
  db.prepare('UPDATE prompts SET version_count = ?, current_version = ? WHERE id = ?').run(versionNum, `${versionNum}.0`, request.prompt_id)

  // 更新标签
  try {
    const tags = JSON.parse(request.tags || '[]')
    if (Array.isArray(tags) && tags.length > 0) {
      db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?').run(request.prompt_id)
      const stmt = db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)')
      for (const tagId of tags) stmt.run(request.prompt_id, tagId, now)
    }
  } catch { /* 标签解析失败，跳过 */ }

  // 更新审核请求状态
  db.prepare(`UPDATE prompt_review_requests SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE id = ?`).run(now, auth.id, id)

  return { success: true, message: '审核通过，已应用修改' }
})