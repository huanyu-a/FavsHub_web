/**
 * PUT /api/folders/:id — 更新文件夹
 * 普通用户禁止修改，仅管理员可操作
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
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
