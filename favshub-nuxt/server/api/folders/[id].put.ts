/**
 * PUT /api/folders/:id — 更新文件夹
 * 仅文件夹所有者或管理员可操作
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const params = getRouterParams(event)
  const body = await readBody(event)
  const { name, sort_order } = body || {}

  if (name !== undefined && name.length > 128) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称最长 128 字符' } })
  }

  const db = getRawDb()

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(params.id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  // 所有权检查：仅文件夹所有者或管理员可修改
  if (folder.user_id !== user.id) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (!dbUser?.is_admin) {
      throw createError({ statusCode: 403, data: { error: '无权修改此文件夹' } })
    }
  }

  const tx = db.transaction(() => {
    if (name !== undefined) {
      db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folder.id)
    }
    if (sort_order !== undefined) {
      db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?').run(sort_order, folder.id)
    }
  })
  tx()

  const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(folder.id)
  return { folder: updated }
})
