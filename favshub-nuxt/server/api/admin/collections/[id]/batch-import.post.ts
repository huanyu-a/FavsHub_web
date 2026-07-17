/**
 * POST /api/admin/collections/:id/batch-import — DH_NavHub 批量导入
 * Body: { data: DH_NavHub_JSON, mode?: 'replace'|'merge' }
 * 写入路径：upsert 管理员公共池 bookmarks → collection_bookmarks 引用
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'
import { isDangerUrl, upsertPoolBookmark } from '../../../../utils/collection-bookmarks'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const { data, mode = 'replace' } = body

  if (!data || !data.categories) {
    throw createError({ statusCode: 400, data: { error: '无效的 DH_NavHub 数据格式' } })
  }

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

  const MAX_CATEGORIES = 50
  const MAX_TOTAL_BOOKMARKS = 5000

  const categoriesInput = data.categories || []
  if (categoriesInput.length > MAX_CATEGORIES) {
    throw createError({ statusCode: 400, data: { error: `分类数不能超过 ${MAX_CATEGORIES} 个` } })
  }

  let estimatedTotal = 0
  for (const cat of categoriesInput) {
    const sites = (cat.sites || []).length
    const childrenSites = (cat.children || []).reduce((sum: number, c: any) => sum + (c.sites || []).length, 0)
    estimatedTotal += sites + childrenSites
  }
  if (estimatedTotal > MAX_TOTAL_BOOKMARKS) {
    throw createError({ statusCode: 400, data: { error: `书签总数不能超过 ${MAX_TOTAL_BOOKMARKS} 个` } })
  }

  try {
    let categoryCount = 0
    let bookmarkCount = 0

    db.transaction(() => {
      const now = Date.now()
      const ownerUserId = collection.user_id

      // merge 模式：按已有 bookmark 引用去重
      const existingBookmarkIds = new Set<number>()
      if (mode === 'merge') {
        const existing = db.prepare(
          'SELECT bookmark_id FROM collection_bookmarks WHERE collection_id = ?'
        ).all(id) as { bookmark_id: number }[]
        existing.forEach(b => existingBookmarkIds.add(b.bookmark_id))
      } else {
        db.prepare('DELETE FROM collection_categories WHERE collection_id = ?').run(id)
        db.prepare('DELETE FROM collection_bookmarks WHERE collection_id = ?').run(id)
      }

      const insCb = db.prepare(`
        INSERT OR IGNORE INTO collection_bookmarks (collection_id, bookmark_id, category_id, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      const categories = data.categories || []

      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i]
        const result = db.prepare(`
          INSERT INTO collection_categories (collection_id, name, parent_id, sort_order, created_at)
          VALUES (?, ?, NULL, ?, ?)
        `).run(id, cat.name || cat.categoryName || `分类${i + 1}`, i, now)

        const categoryId = result.lastInsertRowid as number
        categoryCount++

        const addSites = (sites: any[], catId: number) => {
          if (!Array.isArray(sites)) return
          for (let j = 0; j < sites.length; j++) {
            const site = sites[j]
            if (!site?.url || isDangerUrl(site.url)) continue
            const bookmarkId = upsertPoolBookmark(db, ownerUserId, {
              title: site.title || site.name || 'Untitled',
              url: site.url,
              icon: site.icon || '',
              description: site.description || site.desc || '',
            }, now)
            if (mode === 'merge' && existingBookmarkIds.has(bookmarkId)) continue
            const r = insCb.run(id, bookmarkId, catId, j, now)
            if (r.changes > 0) {
              existingBookmarkIds.add(bookmarkId)
              bookmarkCount++
            }
          }
        }

        addSites(cat.sites, categoryId)

        if (cat.children && Array.isArray(cat.children)) {
          for (let j = 0; j < cat.children.length; j++) {
            const subCat = cat.children[j]
            const subResult = db.prepare(`
              INSERT INTO collection_categories (collection_id, name, parent_id, sort_order, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(id, subCat.name || subCat.categoryName || `子分类${j + 1}`, categoryId, j, now)

            const subCategoryId = subResult.lastInsertRowid as number
            categoryCount++
            addSites(subCat.sites, subCategoryId)
          }
        }
      }

      // replace 用本次计数；merge 重新统计总数
      const total = mode === 'merge'
        ? (db.prepare('SELECT COUNT(*) as n FROM collection_bookmarks WHERE collection_id = ?').get(id) as { n: number }).n
        : bookmarkCount

      db.prepare(`
        UPDATE collections SET bookmark_count = ?, updated_at = ? WHERE id = ?
      `).run(total, now, id)
    })()

    return {
      success: true,
      category_count: categoryCount,
      bookmark_count: bookmarkCount,
      message: `成功导入 ${categoryCount} 个分类和 ${bookmarkCount} 个书签`
    }
  } catch (err: any) {
    console.error('批量导入失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '批量导入失败' } })
  }
})
