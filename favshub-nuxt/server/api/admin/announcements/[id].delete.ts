import { defineEventHandler, createError } from 'h3'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

/**
 * DELETE /api/admin/announcements/:id — 删除公告（管理员）
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(event.context.params?.id)
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: '无效的公告 ID' })
  }

  const db = getRawDb()
  const existing = db.prepare('SELECT id FROM announcements WHERE id = ?').get(id)
  if (!existing) {
    throw createError({ statusCode: 404, message: '公告不存在' })
  }

  try {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id)
    return {
      code: 200,
      message: '删除公告成功',
    }
  } catch (err: any) {
    console.error('删除公告失败:', err)
    throw createError({ statusCode: 500, message: '删除失败: ' + (err.message || '未知错误') })
  }
})
