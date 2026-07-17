/**
 * PUT /api/collections/:id — 更新精选集
 * Body: { name, description, icon, meta_title, meta_description, meta_keywords, is_public, categories, bookmarks }
 * bookmarks 支持 { bookmark_id } 或 { title, url, ... }
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { insertCollectionBookmarks } from '../../utils/collection-bookmarks'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const db = getRawDb()

  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as any
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }
  if (collection.user_id !== user.id) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as any
    if (!dbUser?.is_admin) {
      throw createError({ statusCode: 403, data: { error: '无权编辑此精选集' } })
    }
  }

  const {
    name,
    description = '',
    icon = '',
    meta_title = '',
    meta_description = '',
    meta_keywords = '',
    is_public = 0,
    categories,
    bookmarks
  } = body

  if (!name || !name.trim()) {
    throw createError({ statusCode: 400, data: { error: '精选集名称不能为空' } })
  }

  const now = Date.now()

  // 防止只更新分类导致书签关联丢失
  if (categories !== undefined && bookmarks === undefined) {
    throw createError({
      statusCode: 400,
      data: { error: 'categories 和 bookmarks 必须同时更新，否则会导致分类关联丢失' }
    })
  }

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE collections
        SET name = ?, description = ?, icon = ?, meta_title = ?, meta_description = ?, meta_keywords = ?, is_public = ?, updated_at = ?
        WHERE id = ?
      `).run(name.trim(), description, icon, meta_title, meta_description, meta_keywords, is_public ? 1 : 0, now, id)

      if (categories !== undefined) {
        db.prepare('DELETE FROM collection_categories WHERE collection_id = ?').run(id)

        const categoryIdMap = new Map<string, number>()
        if (categories && categories.length > 0) {
          const sorted = [...categories].sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0))
          for (const cat of sorted) {
            const tempId = cat.temp_id || cat.id
            let parentId = cat.parent_id || null
            if (parentId != null && categoryIdMap.has(String(parentId))) {
              parentId = categoryIdMap.get(String(parentId))!
            }
            const result = db.prepare(`
              INSERT INTO collection_categories (collection_id, name, parent_id, sort_order, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(id, cat.name, parentId, cat.sort_order || 0, now)

            if (tempId) categoryIdMap.set(String(tempId), result.lastInsertRowid as number)
          }
        }

        if (bookmarks !== undefined) {
          db.prepare('DELETE FROM collection_bookmarks WHERE collection_id = ?').run(id)

          const bookmarkCount = insertCollectionBookmarks(db, {
            collectionId: id,
            ownerUserId: collection.user_id,
            bookmarks: bookmarks || [],
            categoryIdMap,
            now,
          })

          db.prepare('UPDATE collections SET bookmark_count = ? WHERE id = ?').run(bookmarkCount, id)
        }
      }
    })()

    return { success: true }
  } catch (err: any) {
    console.error('更新精选集失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '更新精选集失败' } })
  }
})
