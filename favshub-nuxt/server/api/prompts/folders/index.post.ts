/**
 * POST /api/prompts/folders — 创建提示词文件夹
 * Body: { name, parent_id?, icon? }
 */
import { randomUUID } from 'node:crypto'
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const { name, parent_id, icon } = body || {}

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称不能为空' } })
  }

  const db = getRawDb()
  const id = randomUUID()
  const now = Date.now()

  db.prepare(`
    INSERT INTO prompt_folders (id, user_id, name, parent_id, icon, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, user.id, name.trim(), parent_id || null, icon || '', now, now)

  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id) as any
  folder.folder_id = folder.id
  folder.folder_name = folder.name

  return { folder }
})
