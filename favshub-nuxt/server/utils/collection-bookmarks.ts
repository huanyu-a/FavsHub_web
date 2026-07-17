/**
 * 精选集书签写入工具
 * collection_bookmarks 只存 bookmark_id 引用；title/url 在 bookmarks 表
 */
import type Database from 'better-sqlite3'

const DANGER_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:']

export function isDangerUrl(url: string | undefined | null): boolean {
  if (!url) return true
  const lower = url.toLowerCase().trim()
  return DANGER_SCHEMES.some(s => lower.startsWith(s))
}

/**
 * 在用户（通常是管理员）书签池中按 URL upsert，返回 bookmark_id。
 * 优先匹配公共池（label=''）；若仅有个人书签则复用其 id 但不改写字段。
 * 新建时 label='' → 公共池。
 */
export function upsertPoolBookmark(
  db: Database.Database,
  userId: number,
  bm: { title?: string; url: string; icon?: string; description?: string },
  now = Date.now(),
): number {
  const url = (bm.url || '').trim()
  if (!url) throw new Error('url is required')

  // 优先公共池，再任意同 URL（UNIQUE 下最多一条）
  const existing = db.prepare(
    `SELECT id, label FROM bookmarks WHERE user_id = ? AND url = ?
     ORDER BY CASE WHEN COALESCE(label, '') = '' THEN 0 ELSE 1 END
     LIMIT 1`
  ).get(userId, url) as { id: number; label: string | null } | undefined

  if (existing) {
    // 仅更新公共池展示字段；个人书签只复用 id，避免污染个人数据
    if (!existing.label) {
      const sets: string[] = ['updated_at = ?']
      const params: any[] = [now]
      if (bm.title) { sets.push('title = ?'); params.push(String(bm.title).slice(0, 256)) }
      if (bm.icon !== undefined) { sets.push('icon = ?'); params.push(bm.icon || null) }
      if (bm.description !== undefined) { sets.push('description = ?'); params.push(bm.description || '') }
      params.push(existing.id)
      db.prepare(`UPDATE bookmarks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    }
    return existing.id
  }

  const title = (bm.title || url).slice(0, 256)
  const result = db.prepare(`
    INSERT INTO bookmarks (user_id, title, url, icon, description, label, login_required, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', 0, '[]', ?, ?)
  `).run(userId, title, url, bm.icon || null, bm.description || '', now, now)

  return Number(result.lastInsertRowid)
}

/**
 * 将书签列表写入 collection_bookmarks（引用模式）
 * 支持两种输入：
 *  - { bookmark_id, category_id?, sort_order? }
 *  - { title, url, icon?, description?, category_id?, sort_order? }（自动 upsert 公共池）
 */
export function insertCollectionBookmarks(
  db: Database.Database,
  options: {
    collectionId: string
    ownerUserId: number
    bookmarks: any[]
    categoryIdMap?: Map<string, number>
    now?: number
  },
): number {
  const { collectionId, ownerUserId, bookmarks, categoryIdMap } = options
  const now = options.now ?? Date.now()
  if (!bookmarks?.length) return 0

  const insCb = db.prepare(`
    INSERT OR IGNORE INTO collection_bookmarks (collection_id, bookmark_id, category_id, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  let count = 0
  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i]
    let categoryId = bm.category_id ?? null
    if (categoryId != null && categoryIdMap?.has(String(categoryId))) {
      categoryId = categoryIdMap.get(String(categoryId))!
    }

    let bookmarkId: number | null = null
    if (bm.bookmark_id != null && !Number.isNaN(Number(bm.bookmark_id))) {
      bookmarkId = Number(bm.bookmark_id)
      const exists = db.prepare('SELECT id FROM bookmarks WHERE id = ?').get(bookmarkId)
      if (!exists) continue
    } else if (bm.url) {
      if (isDangerUrl(bm.url)) continue
      bookmarkId = upsertPoolBookmark(db, ownerUserId, bm, now)
    } else {
      continue
    }

    const result = insCb.run(collectionId, bookmarkId, categoryId, bm.sort_order ?? i, now)
    if (result.changes > 0) count++
  }
  return count
}
