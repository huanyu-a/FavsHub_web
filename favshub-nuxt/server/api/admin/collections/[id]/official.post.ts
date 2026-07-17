/**
 * POST /api/admin/collections/:id/official — 设为官方推荐
 * Body: { is_official: 0|1 }
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const { is_official } = body

  if (is_official === undefined) {
    throw createError({ statusCode: 400, data: { error: '缺少 is_official 参数' } })
  }

  const db = getRawDb()

  // 验证精选集存在
  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as any
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }

  try {
    const now = Date.now()
    db.prepare(`
      UPDATE collections
      SET is_official = ?, updated_at = ?
      WHERE id = ?
    `).run(is_official ? 1 : 0, now, id)

    return {
      success: true,
      message: is_official ? '已设为官方推荐' : '已取消官方推荐'
    }
  } catch (err: any) {
    console.error('更新官方状态失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '更新官方状态失败' } })
  }
})
