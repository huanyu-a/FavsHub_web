/**
 * DELETE /api/admin/users/:id — 删除用户及其所有数据
 * D7/A7: 数据清理集中在 server/utils/delete-user.ts，避免手写多条 DELETE 遗漏新表
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { deleteUserData } from '../../../utils/delete-user'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const userId = parseInt(id)
  if (isNaN(userId)) {
    throw createError({ statusCode: 400, data: { error: '无效的用户 ID' } })
  }

  if (userId === 0) {
    throw createError({ statusCode: 400, data: { error: '不能删除系统用户' } })
  }

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any
  if (!user) {
    throw createError({ statusCode: 404, data: { error: '用户不存在' } })
  }

  deleteUserData(db, userId)

  return { success: true, message: `已删除用户 ${user.username} 及其所有数据` }
})
