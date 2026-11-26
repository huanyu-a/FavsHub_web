import type Database from 'better-sqlite3'
import { getConfigInt } from './config'
import { hasPersonalLabel, isPoolBookmark, normalizeUrl } from './bookmark-labels'
import { getUserSyncSnapshot } from './sync-snapshot'

interface IncomingBookmark {
  title?: string
  url?: string
  folder_path?: string | null
  folder?: string | null
  icon?: string | null
  sort_order?: number
  container?: string
}

interface ExistingSyncBookmark {
  id: number
  url: string
  source: string | null
  label: string | null
}

function dedupeIncomingBookmarks(bookmarks: IncomingBookmark[]): (IncomingBookmark & { url: string })[] {
  const byNormalizedUrl = new Map<string, IncomingBookmark & { url: string }>()
  for (const source of bookmarks) {
    if (!source.url || source.url.length > 2048) continue
    const bm = { ...source, url: normalizeUrl(source.url) }
    if (bm.title && bm.title.length > 256) bm.title = bm.title.slice(0, 256)
    if (bm.icon && bm.icon.length > 2048) bm.icon = null
    // delete + set 同时保证值与执行顺序均为 last-wins。
    byNormalizedUrl.delete(bm.url)
    byNormalizedUrl.set(bm.url, bm)
  }
  return [...byNormalizedUrl.values()]
}

export interface SyncUploadBody {
  bookmarks?: IncomingBookmark[]
  force?: boolean
  expected_revision?: string
}

export interface SyncUploadResult {
  success: true
  added: number
  updated: number
  deleted: number
  foldersCreated: number
  foldersDeleted: number
  total: number
  revision: string
}

function resolveFolderPath(folderPath: string | null, options: {
  userId: number
  findFolder: Database.Statement
  createFolder: Database.Statement
  folderCache: Map<string, number>
  now: number
  onCreated: () => void
}): number | null {
  if (!folderPath) return null
  if (options.folderCache.has(folderPath)) return options.folderCache.get(folderPath)!

  const segments = folderPath.split('/')
  let currentParentId: number | null = null
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const partialPath = segments.slice(0, i + 1).join('/')
    if (options.folderCache.has(partialPath)) {
      currentParentId = options.folderCache.get(partialPath)!
      continue
    }
    const row = options.findFolder.get(options.userId, segment, currentParentId, currentParentId) as { id: number } | undefined
    if (row) {
      currentParentId = row.id
    } else {
      const result = options.createFolder.run(options.userId, segment, currentParentId, 0, options.now, options.now)
      currentParentId = Number(result.lastInsertRowid)
      options.onCreated()
    }
    options.folderCache.set(partialPath, currentParentId)
  }
  return currentParentId
}

export function syncUploadBookmarks(
  db: Database.Database,
  userId: number,
  body: SyncUploadBody,
  now = Date.now(),
): SyncUploadResult {
  const inputBookmarks = body?.bookmarks
  const force = body?.force
  if (!Array.isArray(inputBookmarks)) {
    throw createError({ statusCode: 400, data: { error: 'bookmarks 必须是数组' } })
  }
  const maxBookmarks = getConfigInt('max_bookmarks_per_sync', 20000)
  if (inputBookmarks.length > maxBookmarks) {
    throw createError({ statusCode: 400, data: { error: `单次同步上限 ${maxBookmarks} 条，当前 ${inputBookmarks.length} 条` } })
  }
  if (inputBookmarks.length === 0 && !force) {
    throw createError({ statusCode: 400, data: { error: 'bookmarks 不能为空数组，如需清空所有书签请传 force: true' } })
  }
  const bookmarks = dedupeIncomingBookmarks(inputBookmarks)
  const expectedRevision = body?.expected_revision
  if (expectedRevision !== undefined && (typeof expectedRevision !== 'string' || !expectedRevision)) {
    throw createError({ statusCode: 400, data: { error: 'expected_revision 必须是非空字符串' } })
  }

  const findFolder = db.prepare('SELECT id FROM folders WHERE user_id = ? AND name = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))')
  const createFolder = db.prepare('INSERT INTO folders (user_id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
  const insertBookmark = db.prepare(`
    INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order, container, source, label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sync', ?, ?)
  `)
  const updateBookmark = db.prepare(`
    UPDATE bookmarks SET
      title = ?, folder_id = ?, icon = COALESCE(?, icon), sort_order = ?,
      container = ?, source = ?, updated_at = ?
    WHERE id = ? AND COALESCE(label, '') != ''
  `)
  const listExisting = db.prepare('SELECT id, url, source, label FROM bookmarks WHERE user_id = ?')

  const folderCache = new Map<string, number>()
  let foldersCreated = 0
  const ensureFolderPath = (path: string | null) => resolveFolderPath(path, {
    userId, findFolder, createFolder, folderCache, now,
    onCreated: () => { foldersCreated++ },
  })

  const syncedContainers = new Set<string>()
  for (const bm of bookmarks) {
    const container = bm.container || ''
    if (container) syncedContainers.add(container)
  }

  let added = 0
  let updated = 0
  let deleted = 0
  let foldersDeleted = 0
  let nextRevision = ''

  const tx = db.transaction(() => {
    // 必须是事务内第一条语句：revision 不匹配时没有任何业务写入。
    if (expectedRevision !== undefined) {
      const current = getUserSyncSnapshot(db, userId).revision
      if (current !== expectedRevision) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Sync Revision Conflict',
          data: { error: 'SYNC_REVISION_CONFLICT', revision: current },
        })
      }
    }

    const exactByUrl = new Map<string, ExistingSyncBookmark>()
    const normalizedPersonal = new Map<string, ExistingSyncBookmark>()
    const normalizedAny = new Map<string, ExistingSyncBookmark>()
    for (const row of listExisting.all(userId) as ExistingSyncBookmark[]) {
      if (!exactByUrl.has(row.url)) exactByUrl.set(row.url, row)
      const normalized = normalizeUrl(row.url)
      if (!normalizedAny.has(normalized)) normalizedAny.set(normalized, row)
      if (hasPersonalLabel(row.label) && !normalizedPersonal.has(normalized)) {
        normalizedPersonal.set(normalized, row)
      }
    }

    const incomingUrls = new Set<string>()
    for (const bm of bookmarks) {
      const folderId = ensureFolderPath(bm.folder_path || bm.folder || null)
      const container = bm.container || ''
      const existing = normalizedPersonal.get(bm.url)
        || exactByUrl.get(bm.url)
        || normalizedAny.get(bm.url)
      if (existing && !hasPersonalLabel(existing.label)) continue
      incomingUrls.add(bm.url)

      let sourceArray = ['sync']
      if (existing?.source) {
        try {
          const existingSource = JSON.parse(existing.source)
          if (Array.isArray(existingSource)) {
            const collectionTags = existingSource.filter((item: string) => item.startsWith('collection:'))
            sourceArray = [...new Set([...sourceArray, ...collectionTags])]
          }
        } catch { /* legacy source is not a JSON array */ }
      }
      const serializedSource = JSON.stringify(sourceArray)
      if (existing) {
        // 保留 legacy 原始 URL，避免规范化插入造成重复；空 icon 不覆盖已有图标。
        updateBookmark.run(
          bm.title || '', folderId, bm.icon || null, bm.sort_order || 0,
          container, serializedSource, now, existing.id,
        )
        existing.source = serializedSource
        updated++
      } else {
        const inserted = insertBookmark.run(
          userId, bm.title || '', bm.url, folderId, bm.icon || null,
          bm.sort_order || 0, container, serializedSource, now, now,
        )
        const created: ExistingSyncBookmark = {
          id: Number(inserted.lastInsertRowid), url: bm.url, source: serializedSource, label: 'sync',
        }
        exactByUrl.set(bm.url, created)
        normalizedPersonal.set(bm.url, created)
        normalizedAny.set(bm.url, created)
        added++
      }
    }

    if (syncedContainers.size > 0) {
      const containerList = [...syncedContainers]
      const placeholders = containerList.map(() => '?').join(',')
      const serverBookmarks = db.prepare(
        `SELECT id, url, label FROM bookmarks WHERE user_id = ? AND container IN (${placeholders}) AND COALESCE(label, '') != ''`,
      ).all(userId, ...containerList) as { id: number; url: string; label: string | null }[]
      const deleteBookmark = db.prepare('DELETE FROM bookmarks WHERE id = ?')
      const demoteBookmark = db.prepare("UPDATE bookmarks SET label = '', updated_at = ? WHERE id = ?")
      for (const sb of serverBookmarks) {
        if (incomingUrls.has(normalizeUrl(sb.url))) continue
        if (isPoolBookmark(sb.label)) demoteBookmark.run(Date.now(), sb.id)
        else deleteBookmark.run(sb.id)
        deleted++
      }
    }

    const protectedIds = new Set<number>()
    const remaining = db.prepare('SELECT DISTINCT folder_id FROM bookmarks WHERE user_id = ? AND folder_id IS NOT NULL').all(userId) as { folder_id: number }[]
    const findParent = db.prepare('SELECT parent_id FROM folders WHERE id = ?')
    for (const row of remaining) {
      let folderId: number | null = row.folder_id
      while (folderId && !protectedIds.has(folderId)) {
        protectedIds.add(folderId)
        const parent = findParent.get(folderId) as { parent_id: number | null } | undefined
        folderId = parent ? parent.parent_id : null
      }
    }

    const containerFolderNames = new Set([
      '书签栏', '其他书签', '移动设备书签',
      'Bookmarks bar', 'Bookmarks Bar', 'Other bookmarks', 'Other Bookmarks',
      'Mobile bookmarks', 'Mobile Bookmarks',
      '书签工具栏', '书签菜单', 'Bookmarks Toolbar', 'Bookmarks Menu',
      '收藏夹栏', '其他收藏夹',
    ])
    const scopeRootIds = new Set<number>()
    const rootFolders = db.prepare('SELECT id, name FROM folders WHERE user_id = ? AND parent_id IS NULL').all(userId) as { id: number; name: string }[]
    for (const folder of rootFolders) {
      if (containerFolderNames.has(folder.name)) scopeRootIds.add(folder.id)
    }

    const scopeIds = new Set<number>()
    const findChildren = db.prepare('SELECT id FROM folders WHERE parent_id = ? AND user_id = ?')
    const collectDescendants = (parentId: number) => {
      scopeIds.add(parentId)
      const children = findChildren.all(parentId, userId) as { id: number }[]
      for (const child of children) collectDescendants(child.id)
    }
    for (const rootId of scopeRootIds) collectDescendants(rootId)

    const toDelete = [...scopeIds].filter(id => !protectedIds.has(id))
    foldersDeleted = toDelete.length
    if (toDelete.length > 0) {
      const placeholders = toDelete.map(() => '?').join(',')
      db.prepare(`UPDATE folders SET parent_id = NULL WHERE id IN (${placeholders})`).run(...toDelete)
      db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...toDelete)
    }
    nextRevision = getUserSyncSnapshot(db, userId).revision
  })
  tx()

  return {
    success: true,
    added,
    updated,
    deleted,
    foldersCreated,
    foldersDeleted,
    total: inputBookmarks.length,
    revision: nextRevision,
  }
}
