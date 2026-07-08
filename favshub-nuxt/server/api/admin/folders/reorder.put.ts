/**
 * PUT /api/admin/folders/reorder — 批量更新文件夹排序
 * 管理员：可更新任意文件夹的排序
 * 普通用户：仅可更新自己文件夹的排序
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()

  const body = await readBody(event)
  const { items } = body

  if (!Array.isArray(items)) {
    throw createError({ statusCode: 400, data: { error: 'items 必须是数组' } })
  }

  const stmt = db.prepare('UPDATE folders SET sort_order = ? WHERE id = ? AND user_id = ?')
  const adminStmt = db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?')

  const tx = db.transaction(() => {
    for (const item of items) {
      if (isAdmin) {
        adminStmt.run(item.sort_order, item.id)
      } else {
        stmt.run(item.sort_order, item.id, auth.id)
      }
    }
  })
  tx()

  return { success: true }
})
