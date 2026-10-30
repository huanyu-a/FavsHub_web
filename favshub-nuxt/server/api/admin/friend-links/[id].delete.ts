import { defineEventHandler, createError } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * DELETE /api/admin/friend-links/:id — 删除友情链接（管理员）
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(event.context.params?.id)
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: '无效的友链 ID' })
  }

  const db = getRawDb()
  const existing = db.prepare('SELECT id FROM friend_links WHERE id = ?').get(id)
  if (!existing) {
    throw createError({ statusCode: 404, message: '友链不存在' })
  }

  try {
    db.prepare('DELETE FROM friend_links WHERE id = ?').run(id)
    return {
      code: 200,
      message: '删除成功',
    }
  } catch (err: any) {
    console.error('删除友情链接失败:', err)
    throw createError({ statusCode: 500, message: '删除失败: ' + (err.message || '未知错误') })
  }
})
