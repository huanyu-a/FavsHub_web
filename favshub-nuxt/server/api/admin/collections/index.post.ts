/**
 * POST /api/admin/collections — 管理员创建精选集
 * Body: { name, description, icon, meta_title, meta_description, meta_keywords, is_public, is_official, categories, bookmarks }
 * bookmarks 支持 { bookmark_id } 或 { title, url, ... }
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { insertCollectionBookmarks } from '../../../utils/collection-bookmarks'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const body = await readBody(event)

  const {
    name,
    description = '',
    icon = '',
    meta_title = '',
    meta_description = '',
    meta_keywords = '',
    is_public = 0,
    is_official = 0,
    categories = [],
    bookmarks = []
  } = body

  if (!name || !name.trim()) {
    throw createError({ statusCode: 400, data: { error: '精选集名称不能为空' } })
  }

  const db = getRawDb()
  const now = Date.now()
  const collectionId = `col_${now}_${Math.random().toString(36).slice(2, 8)}`

  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO collections (id, user_id, name, description, icon, meta_title, meta_description, meta_keywords, is_public, is_official, bookmark_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(collectionId, user.id, name.trim(), description, icon, meta_title, meta_description, meta_keywords, is_public ? 1 : 0, is_official ? 1 : 0, 0, now, now)

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
          `).run(collectionId, cat.name, parentId, cat.sort_order || 0, now)

          if (tempId) categoryIdMap.set(String(tempId), result.lastInsertRowid as number)
        }
      }

      const bookmarkCount = insertCollectionBookmarks(db, {
        collectionId,
        ownerUserId: user.id,
        bookmarks: bookmarks || [],
        categoryIdMap,
        now,
      })

      if (bookmarkCount > 0) {
        db.prepare('UPDATE collections SET bookmark_count = ? WHERE id = ?').run(bookmarkCount, collectionId)
      }
    })()

    return { success: true, collection_id: collectionId }
  } catch (err: any) {
    console.error('[Admin] 创建精选集失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '创建精选集失败' } })
  }
})
