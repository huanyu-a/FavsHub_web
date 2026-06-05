/**
 * POST /api/folders — 创建文件夹
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { name, parent_id } = body || {}

  if (!name) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称不能为空' } })
  }
  if (name.length > 128) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称最长 128 字符' } })
  }

  const db = getRawDb()

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM folders WHERE user_id = ?').get(user.id) as { m: number | null } | undefined
  const result = db.prepare(
    'INSERT INTO folders (user_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)'
  ).run(user.id, name, parent_id || null, (maxOrder?.m || 0) + 1)

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid)
  return { folder }
})
