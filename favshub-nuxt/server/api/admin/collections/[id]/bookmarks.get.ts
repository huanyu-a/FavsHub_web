/**
 * 获取精选集的完整书签列表（含分类）
 * GET /api/admin/collections/:id/bookmarks
 * 用于后台管理页面展开行查看书签
 */
import { getRawDb } from '~/server/database'
import { requireAdmin } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const collectionId = getRouterParam(event, 'id')
  if (!collectionId) {
    throw createError({ statusCode: 400, message: 'Collection ID is required' })
  }

  const db = getRawDb()

  try {
    // 获取精选集基本信息（包含所有字段）
    const collection = db.prepare(`
      SELECT *
      FROM collections
      WHERE id = ?
    `).get(collectionId)

    if (!collection) {
      throw createError({ statusCode: 404, message: 'Collection not found' })
    }

    // 获取分类列表
    const categories = db.prepare(`
      SELECT id, name, parent_id, sort_order, created_at
      FROM collection_categories
      WHERE collection_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(collectionId)

    // 获取书签列表（含分类名称，JOIN bookmarks）
    const bookmarks = db.prepare(`
      SELECT
        cb.id, cb.bookmark_id, cb.category_id, cb.sort_order, cb.created_at,
        b.url, b.title, b.icon, b.description,
        cc.name as category_name
      FROM collection_bookmarks cb
      JOIN bookmarks b ON cb.bookmark_id = b.id
      LEFT JOIN collection_categories cc ON cb.category_id = cc.id
      WHERE cb.collection_id = ?
      ORDER BY cc.sort_order ASC, cb.sort_order ASC, cb.id ASC
    `).all(collectionId)

    return {
      collection,
      categories,
      bookmarks
    }
  } catch (error: any) {
    console.error('[Admin] 获取精选集书签失败:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch collection bookmarks',
      data: { error: error.message }
    })
  }
})
