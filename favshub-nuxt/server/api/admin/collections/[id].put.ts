/**
 * PUT /api/admin/collections/:id — 管理员编辑精选集
 * Body: { name, description, icon, meta_title, meta_description, meta_keywords, is_public, is_official, categories, bookmarks }
 * 管理员可编辑任意精选集，包括设置 is_official
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { insertCollectionBookmarks } from '../../../utils/collection-bookmarks'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const db = getRawDb()

  // 验证精选集存在
  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as any
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }

  const {
    name,
    description,
    icon,
    meta_title,
    meta_description,
    meta_keywords,
    is_public,
    is_official,
    categories,
    bookmarks
  } = body

  if (name !== undefined && (!name || !name.trim())) {
    throw createError({ statusCode: 400, data: { error: '精选集名称不能为空' } })
  }

  const now = Date.now()

  // 构建动态 UPDATE
  const setClauses: string[] = ['updated_at = ?']
  const params: any[] = [now]

  if (name !== undefined) { setClauses.push('name = ?'); params.push(name.trim()) }
  if (description !== undefined) { setClauses.push('description = ?'); params.push(description) }
  if (icon !== undefined) { setClauses.push('icon = ?'); params.push(icon) }
  if (meta_title !== undefined) { setClauses.push('meta_title = ?'); params.push(meta_title) }
  if (meta_description !== undefined) { setClauses.push('meta_description = ?'); params.push(meta_description) }
  if (meta_keywords !== undefined) { setClauses.push('meta_keywords = ?'); params.push(meta_keywords) }
  if (is_public !== undefined) { setClauses.push('is_public = ?'); params.push(is_public ? 1 : 0) }
  if (is_official !== undefined) { setClauses.push('is_official = ?'); params.push(is_official ? 1 : 0) }

  try {
    db.transaction(() => {
      // 1. 更新基础信息
      if (setClauses.length > 1) {
        params.push(id)
        db.prepare(`UPDATE collections SET ${setClauses.join(', ')} WHERE id = ?`).run(...params)
      }

      // 2. 如果传入了分类数据，重建分类和书签
      if (categories !== undefined) {
        if (bookmarks === undefined) {
          throw createError({
            statusCode: 400,
            data: { error: 'categories 和 bookmarks 必须同时更新，否则会导致分类关联丢失' }
          })
        }

        // 删除旧分类（级联删除关联的 collection_bookmarks 的 category_id）
        db.prepare('DELETE FROM collection_categories WHERE collection_id = ?').run(id)

        // 创建新分类（两遍：先建顶级，再建子级以正确解析 parent_id）
        const categoryIdMap = new Map<string, number>()
        if (categories && categories.length > 0) {
          // 排序：顶级（无 parent_id）优先，确保子分类创建时父级 ID 已存在
          const sorted = [...categories].sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0))

          for (const cat of sorted) {
            const tempId = cat.temp_id || cat.id
            // 解析 parent_id：如果是 temp_id 引用则查 map，否则直接用数据库 ID
            let resolvedParentId = cat.parent_id || null
            if (resolvedParentId && categoryIdMap.has(resolvedParentId.toString())) {
              resolvedParentId = categoryIdMap.get(resolvedParentId.toString())
            }

            const result = db.prepare(`
              INSERT INTO collection_categories (collection_id, name, parent_id, sort_order, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(id, cat.name, resolvedParentId, cat.sort_order || 0, now)

            if (tempId) {
              categoryIdMap.set(tempId.toString(), result.lastInsertRowid as number)
            }
          }
        }

        // 3. 重建书签（引用 bookmarks：支持 bookmark_id 或 title/url upsert 公共池）
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
    })()

    return { success: true }
  } catch (err: any) {
    console.error('[Admin] 更新精选集失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '更新精选集失败' } })
  }
})
