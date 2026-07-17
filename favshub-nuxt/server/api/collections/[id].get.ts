/**
 * GET /api/collections/:id — 精选集详情
 * 返回：collection 信息 + categories 分组 + bookmarks 列表
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const { id } = getRouterParams(event)
  const db = getRawDb()

  // 查询精选集
  const collection = db.prepare(`
    SELECT c.*, u.username, u.nickname
    FROM collections c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `).get(id) as any

  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }

  // 权限检查：非公开的只有所有者能看
  if (!collection.is_public && (!user || collection.user_id !== user.id)) {
    throw createError({ statusCode: 403, data: { error: '无权访问此精选集' } })
  }

  // 查询分类（二级结构）
  const categories = db.prepare(`
    SELECT * FROM collection_categories
    WHERE collection_id = ?
    ORDER BY parent_id NULLS FIRST, sort_order
  `).all(id) as any[]

  // FIX: MAJOR #6 - 添加数据量保护，防止超大精选集导致 OOM
  const query = getQuery(event)
  const page = query.page ? Math.max(1, parseInt(query.page as string)) : null
  const limit = page ? Math.min(500, Math.max(1, parseInt(query.limit as string) || 100)) : null

  // 先查询书签总数
  const countResult = db.prepare(`
    SELECT COUNT(*) as total FROM collection_bookmarks WHERE collection_id = ?
  `).get(id) as { total: number }

  // 如果超过 1000 条且未分页，返回错误提示
  if (!page && countResult.total > 1000) {
    throw createError({
      statusCode: 400,
      data: {
        error: '书签数量过多，请使用分页参数',
        total: countResult.total,
        suggestion: '?page=1&limit=100'
      }
    })
  }

  // 查询书签（JOIN bookmarks 获取 title/url/icon）
  let bookmarksSql = `
    SELECT cb.*, b.url, b.title, b.icon, b.description
    FROM collection_bookmarks cb
    JOIN bookmarks b ON cb.bookmark_id = b.id
    WHERE cb.collection_id = ?
    ORDER BY cb.category_id NULLS FIRST, cb.sort_order
  `
  let bookmarks: any[]
  if (limit && page) {
    bookmarksSql += ` LIMIT ? OFFSET ?`
    bookmarks = db.prepare(bookmarksSql).all(id, limit, (page - 1) * limit) as any[]
  } else {
    bookmarks = db.prepare(bookmarksSql).all(id) as any[]
  }

  // 如果是登录用户，返回订阅和导入状态
  if (user) {
    const isSubscribed = db.prepare(`
      SELECT 1 FROM collection_subscriptions
      WHERE user_id = ? AND collection_id = ?
    `).get(user.id, id)

    const importedCount = db.prepare(`
      SELECT COUNT(*) as count FROM collection_imports
      WHERE user_id = ? AND collection_id = ?
    `).get(user.id, id) as { count: number }

    const totalCount = countResult.total
    const newCount = totalCount - importedCount.count

    return {
      collection,
      categories,
      bookmarks,
      is_subscribed: !!isSubscribed,
      imported_count: importedCount.count,
      total_count: totalCount,
      new_count: Math.max(0, newCount),
      ...(page && { pagination: { page, limit, total: totalCount, totalPages: Math.ceil(totalCount / limit) } })
    }
  }

  return {
    collection,
    categories,
    bookmarks,
    ...(page && { pagination: { page, limit, total: countResult.total, totalPages: Math.ceil(countResult.total / limit) } })
  }
})
