/**
 * POST /api/tags — 创建标签
 * Body: { name }
 */
import { randomUUID } from 'node:crypto'
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { name } = body || {}

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw createError({ statusCode: 400, data: { error: '标签名称不能为空' } })
  }

  const db = getRawDb()

  // 检查同名标签是否已存在
  const existing = db.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ?').get(user.id, name.trim()) as any
  if (existing) {
    return { tag: existing }
  }

  const id = randomUUID()
  const now = Date.now()

  db.prepare(
    'INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, user.id, name.trim(), now, now)

  const tag = db.prepare('SELECT *, id as tag_id, name as tag_name FROM tags WHERE id = ?').get(id)
  return { tag }
})
