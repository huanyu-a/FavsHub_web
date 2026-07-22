/**
 * GET /api/collections/:id — 精选集详情
 * 返回：collection 信息 + categories 分组 + bookmarks 列表
 *
 * 分类展示规则：优先继承书签自身的 folders（folder_id）树；
 * 若公共池书签无 folder，再回退到 collection_categories。
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

  // 原始精选集内置分类（回退用）
  const builtInCategories = db.prepare(`
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

  // 查询书签：JOIN bookmarks + folders，继承书签自身分类
  let bookmarksSql = `
    SELECT
      cb.id,
      cb.collection_id,
      cb.bookmark_id,
      cb.sort_order,
      cb.created_at,
      cb.category_id AS collection_category_id,
      b.url, b.title, b.icon, b.description, b.need_proxy,
      b.folder_id,
      f.name AS folder_name,
      f.parent_id AS folder_parent_id,
      f.sort_order AS folder_sort,
      pf.name AS folder_parent_name,
      pf.sort_order AS folder_parent_sort
    FROM collection_bookmarks cb
    JOIN bookmarks b ON cb.bookmark_id = b.id
    LEFT JOIN folders f ON b.folder_id = f.id
    LEFT JOIN folders pf ON f.parent_id = pf.id
    WHERE cb.collection_id = ?
    ORDER BY
      COALESCE(pf.sort_order, f.sort_order, 9999),
      COALESCE(pf.name, f.name, ''),
      COALESCE(f.sort_order, 9999),
      COALESCE(f.name, ''),
      cb.sort_order
  `
  let rawBookmarks: any[]
  if (limit && page) {
    bookmarksSql += ` LIMIT ? OFFSET ?`
    rawBookmarks = db.prepare(bookmarksSql).all(id, limit, (page - 1) * limit) as any[]
  } else {
    rawBookmarks = db.prepare(bookmarksSql).all(id) as any[]
  }

  // 统计有 folder 的书签占比；有一定比例则按文件夹树展示
  const withFolder = rawBookmarks.filter(b => b.folder_id != null).length
  const useFolderCats = withFolder > 0 && withFolder >= Math.ceil(rawBookmarks.length * 0.3)

  let categories: any[] = []
  let bookmarks: any[] = []

  if (useFolderCats) {
    // 从书签 folder 构建二级分类树（id = folder.id，与前端 category_id 对齐）
    const folderMap = new Map<number, any>()
    for (const b of rawBookmarks) {
      if (b.folder_id == null) continue
      if (!folderMap.has(b.folder_id)) {
        folderMap.set(b.folder_id, {
          id: b.folder_id,
          collection_id: id,
          name: b.folder_name || '未命名',
          parent_id: b.folder_parent_id ?? null,
          sort_order: b.folder_sort ?? 0,
          created_at: null,
          _source: 'folder',
        })
      }
      // 确保父分类节点也在列表中（即使父级本身没有直属书签）
      if (b.folder_parent_id != null && !folderMap.has(b.folder_parent_id)) {
        folderMap.set(b.folder_parent_id, {
          id: b.folder_parent_id,
          collection_id: id,
          name: b.folder_parent_name || '未命名',
          parent_id: null,
          sort_order: b.folder_parent_sort ?? 0,
          created_at: null,
          _source: 'folder',
        })
      }
    }
    categories = [...folderMap.values()].sort((a, b) => {
      const ap = a.parent_id ?? 0, bp = b.parent_id ?? 0
      if (ap !== bp) return ap - bp
      return (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name), 'zh')
    })

    // 响应中的 category_id 改为 folder_id，便于前端现有分组逻辑
    bookmarks = rawBookmarks.map(b => ({
      id: b.id,
      collection_id: b.collection_id,
      bookmark_id: b.bookmark_id,
      category_id: b.folder_id ?? null,
      sort_order: b.sort_order,
      created_at: b.created_at,
      url: b.url,
      title: b.title,
      icon: b.icon,
      description: b.description,
      need_proxy: b.need_proxy,
      folder_id: b.folder_id,
      folder_name: b.folder_name,
    }))
  } else {
    categories = builtInCategories
    bookmarks = rawBookmarks.map(b => ({
      id: b.id,
      collection_id: b.collection_id,
      bookmark_id: b.bookmark_id,
      category_id: b.collection_category_id ?? null,
      sort_order: b.sort_order,
      created_at: b.created_at,
      url: b.url,
      title: b.title,
      icon: b.icon,
      description: b.description,
      need_proxy: b.need_proxy,
      folder_id: b.folder_id,
      folder_name: b.folder_name,
    }))
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
      category_source: useFolderCats ? 'folder' : 'collection',
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
    category_source: useFolderCats ? 'folder' : 'collection',
    ...(page && { pagination: { page, limit, total: countResult.total, totalPages: Math.ceil(countResult.total / limit) } })
  }
})
