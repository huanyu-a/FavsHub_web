/**
 * POST /api/collections/:id/import — 导入书签到个人空间
 * Body: { mode: 'all'|'category'|'selected', category_id?, bookmark_ids?: number[] }
 *
 * 逻辑：
 * 1. URL 唯一去重：查 bookmarks 表 WHERE user_id=? AND url=?
 *    - 已存在 → skipped++（不修改原书签），仍记录 collection_imports
 *    - 不存在 → 创建新书签（label='import'）并记录 collection_imports
 * 2. 保留分类结构：为每个精选集分类查找/创建同名文件夹
 * 3. 订阅和导入是独立操作，导入不再自动订阅
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { normalizeUrl } from '../../../utils/bookmark-labels'
import { isPrivateOrLocalHost } from '../../../../utils/favicon'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const { mode = 'all', category_id, bookmark_ids = [] } = body

  if (!['all', 'category', 'selected'].includes(mode)) {
    throw createError({ statusCode: 400, data: { error: '无效的导入模式' } })
  }

  if (mode === 'category' && !category_id) {
    throw createError({ statusCode: 400, data: { error: '分类导入需要提供 category_id' } })
  }

  if (mode === 'selected' && bookmark_ids.length === 0) {
    throw createError({ statusCode: 400, data: { error: '选择导入需要提供 bookmark_ids' } })
  }

  const db = getRawDb()

  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as any
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }
  if (!collection.is_public && collection.user_id !== user.id) {
    throw createError({ statusCode: 403, data: { error: '该精选集不公开' } })
  }

  try {
    let imported = 0
    let skipped = 0

    db.transaction(() => {
      let bookmarksToImport: any[] = []
      const SELECT_SQL = `SELECT cb.*, b.url, b.title, b.icon, b.description FROM collection_bookmarks cb JOIN bookmarks b ON cb.bookmark_id = b.id`
      if (mode === 'all') {
        bookmarksToImport = db.prepare(`
          ${SELECT_SQL} WHERE cb.collection_id = ? LIMIT 5000
        `).all(id) as any[]
      } else if (mode === 'category') {
        bookmarksToImport = db.prepare(`
          ${SELECT_SQL} WHERE cb.collection_id = ? AND cb.category_id = ? LIMIT 5000
        `).all(id, category_id) as any[]
      } else if (mode === 'selected') {
        const ids = bookmark_ids.slice(0, 500)
        const placeholders = ids.map(() => '?').join(',')
        bookmarksToImport = db.prepare(`
          ${SELECT_SQL} WHERE cb.collection_id = ? AND cb.id IN (${placeholders})
        `).all(id, ...ids) as any[]
      }

      if (bookmarksToImport.length === 0) {
        return
      }

      const categoryMap = new Map<number, string>()
      const allCategories = db.prepare(`
        SELECT id, name FROM collection_categories WHERE collection_id = ?
      `).all(id) as any[]
      for (const cat of allCategories) {
        categoryMap.set(cat.id, cat.name)
      }

      // url → personal bookmark id（按归一化 URL 匹配，避免仅尾 / 差异产生重复）
      const existingByUrl = new Map<string, number>()
      for (const b of db.prepare('SELECT id, url FROM bookmarks WHERE user_id = ?').all(user.id) as any[]) {
        existingByUrl.set(normalizeUrl(b.url), b.id)
      }

      const existingFolders = new Map<string, number>()
      const userFolders = db.prepare('SELECT id, name FROM folders WHERE user_id = ?').all(user.id) as any[]
      for (const f of userFolders) {
        existingFolders.set(f.name, f.id)
      }

      const now = Date.now()

      const insertFolderStmt = db.prepare(`
        INSERT INTO folders (user_id, name, sort_order, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
      `)

      const insertBookmarkStmt = db.prepare(`
        INSERT INTO bookmarks (user_id, title, url, folder_id, icon, login_required, label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 'import', ?, ?)
      `)

      const insertImportStmt = db.prepare(`
        INSERT OR IGNORE INTO collection_imports (user_id, collection_id, collection_bookmark_id, bookmark_id, imported_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      for (const collBm of bookmarksToImport) {
        let personalBookmarkId: number | null = null
        const normUrl = normalizeUrl(collBm.url || '')

        if (existingByUrl.has(normUrl)) {
          personalBookmarkId = existingByUrl.get(normUrl)!
          skipped++
        } else {
          let icon = collBm.icon || ''
          if (!icon) {
            // 不落远程 URL：留空即可，前端 resolveBookmarkIcon 会走 /api/favicon 代理本地化
            try {
              const hostname = new URL(collBm.url).hostname
              if (isPrivateOrLocalHost(hostname)) icon = ''
            } catch { /* keep empty */ }
          }

          let folderId: number | null = null
          const categoryName = collBm.category_id ? categoryMap.get(collBm.category_id) : null

          if (categoryName) {
            if (existingFolders.has(categoryName)) {
              folderId = existingFolders.get(categoryName)!
            } else {
              const result = insertFolderStmt.run(user.id, categoryName, now, now)
              folderId = result.lastInsertRowid as number
              existingFolders.set(categoryName, folderId)
            }
          }

          const result = insertBookmarkStmt.run(
            user.id,
            collBm.title,
            normUrl,
            folderId,
            icon,
            now,
            now
          )
          personalBookmarkId = Number(result.lastInsertRowid)
          existingByUrl.set(normUrl, personalBookmarkId)
          imported++
        }

        // 无论新建还是跳过，都记录导入状态（供 new_count 计算）
        if (personalBookmarkId != null && collBm.id != null) {
          insertImportStmt.run(user.id, id, collBm.id, personalBookmarkId, now)
        }
      }
    })()

    return {
      success: true,
      imported,
      skipped,
      message: `成功导入 ${imported} 个书签` + (skipped > 0 ? `，跳过 ${skipped} 个已存在` : '')
    }
  } catch (err: any) {
    console.error('导入书签失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '导入书签失败' } })
  }
})
