/**
 * PUT /api/sync/bookmarks — 增量合并同步（浏览器扩展主同步端点）
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { getConfigInt } from '../../../utils/config'

function getMaxBookmarksPerSync(): number {
  return getConfigInt('max_bookmarks_per_sync', 20000)
}

function resolveFolderPath(folderPath: string | null, options: {
  userId: number
  findFolder: import('better-sqlite3').Statement
  createFolder: import('better-sqlite3').Statement
  folderCache: Map<string, number>
  now: number
  onCreated?: () => void
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

    let folderRow = options.findFolder.get(options.userId, segment, currentParentId, currentParentId) as { id: number } | undefined
    if (!folderRow) {
      const result = options.createFolder.run(options.userId, segment, currentParentId, 0, options.now, options.now)
      currentParentId = Number(result.lastInsertRowid)
      if (options.onCreated) options.onCreated()
    } else {
      currentParentId = folderRow.id
    }
    options.folderCache.set(partialPath, currentParentId)
  }

  return currentParentId
}

export default defineEventHandler(async (event) => {
  const authUser = requireAuth(event)
  const body = await readBody(event)
  const { bookmarks, force } = body || {}

  if (!Array.isArray(bookmarks)) {
    throw createError({ statusCode: 400, data: { error: 'bookmarks 必须是数组' } })
  }
  const maxBookmarks = getMaxBookmarksPerSync()
  if (bookmarks.length > maxBookmarks) {
    throw createError({ statusCode: 400, data: { error: `单次同步上限 ${maxBookmarks} 条，当前 ${bookmarks.length} 条` } })
  }
  if (bookmarks.length === 0 && !force) {
    throw createError({ statusCode: 400, data: { error: 'bookmarks 不能为空数组，如需清空所有书签请传 force: true' } })
  }

  const db = getRawDb()
  const now = Date.now()
  const userId = authUser.id

  const findFolder = db.prepare('SELECT id FROM folders WHERE user_id = ? AND name = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))')
  const createFolder = db.prepare('INSERT INTO folders (user_id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
  // 冲突时：公共池(label='')不更新；个人书签更新字段但永不改 label
  const upsertBookmark = db.prepare(`
    INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order, container, source, label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sync', ?, ?)
    ON CONFLICT(user_id, url) DO UPDATE SET
      title = excluded.title,
      folder_id = excluded.folder_id,
      icon = excluded.icon,
      sort_order = excluded.sort_order,
      container = excluded.container,
      source = excluded.source,
      updated_at = excluded.updated_at
    WHERE COALESCE(bookmarks.label, '') != ''
  `)
  const checkExisting = db.prepare('SELECT id, source, label FROM bookmarks WHERE user_id = ? AND url = ?')

  const folderCache = new Map<string, number>()
  let foldersCreated = 0
  const ensureFolderPath = (path: string | null) => resolveFolderPath(path, {
    userId, findFolder, createFolder, folderCache, now,
    onCreated: () => { foldersCreated++ }
  })

  // 收集入站数据的容器集合
  const syncedContainers = new Set<string>()
  for (const bm of bookmarks) {
    const c = bm.container || ''
    if (c) syncedContainers.add(c)
  }

  let added = 0
  let updated = 0
  let deleted = 0

  const tx = db.transaction(() => {
    // 阶段 1 + 2：文件夹解析 + 书签 Upsert
    const incomingUrls = new Set<string>()
    for (const bm of bookmarks) {
      // 跳过字段超长的条目
      if (!bm.url || bm.url.length > 2048) continue
      if (bm.title && bm.title.length > 256) bm.title = bm.title.slice(0, 256)
      if (bm.icon && bm.icon.length > 2048) bm.icon = null

      const folderId = ensureFolderPath(bm.folder_path || bm.folder || null)
      const container = bm.container || ''

      const existing = checkExisting.get(userId, bm.url) as { id: number; source: string | null; label: string | null } | undefined
      // 公共池 URL 不参与同步写入
      if (existing && !existing.label) {
        continue
      }
      incomingUrls.add(bm.url)
      // 保留已有的 collection:xxx 标签，合并 sync 标签
      let sourceArray = ['sync']
      if (existing?.source) {
        try {
          const existingSource = JSON.parse(existing.source)
          if (Array.isArray(existingSource)) {
            const collectionTags = existingSource.filter((s: string) => s.startsWith('collection:'))
            sourceArray = [...new Set([...sourceArray, ...collectionTags])]
          }
        } catch { /* source 不是 JSON 数组，忽略 */ }
      }
      upsertBookmark.run(userId, bm.title, bm.url, folderId, bm.icon || null, bm.sort_order || 0, container, JSON.stringify(sourceArray), now, now)
      if (existing) updated++; else added++
    }

    // 阶段 3：范围删除（仅删除本次同步涉及的容器中的「个人」书签，不动公共池）
    if (syncedContainers.size > 0) {
      const containerList = [...syncedContainers]
      const placeholders = containerList.map(() => '?').join(',')
      const serverBookmarks = db.prepare(
        `SELECT id, url FROM bookmarks WHERE user_id = ? AND container IN (${placeholders}) AND COALESCE(label, '') != ''`
      ).all(userId, ...containerList) as { id: number; url: string }[]

      const deleteBookmark = db.prepare('DELETE FROM bookmarks WHERE id = ?')
      for (const sb of serverBookmarks) {
        if (!incomingUrls.has(sb.url)) {
          deleteBookmark.run(sb.id)
          deleted++
        }
      }
    }

    // 阶段 4：文件夹清理
    const protectedIds = new Set<number>()
    const allRemainingBookmarks = db.prepare('SELECT DISTINCT folder_id FROM bookmarks WHERE user_id = ? AND folder_id IS NOT NULL').all(userId) as { folder_id: number }[]
    for (const row of allRemainingBookmarks) {
      let fid: number | null = row.folder_id
      while (fid && !protectedIds.has(fid)) {
        protectedIds.add(fid)
        const parent = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(fid) as { parent_id: number | null } | undefined
        fid = parent ? parent.parent_id : null
      }
    }

    // 找出同步容器范围内的顶级文件夹
    const containerFolderNames = new Set([
      '书签栏', '其他书签', '移动设备书签',
      'Bookmarks bar', 'Bookmarks Bar', 'Other bookmarks', 'Other Bookmarks',
      'Mobile bookmarks', 'Mobile Bookmarks',
      '书签工具栏', '书签菜单', 'Bookmarks Toolbar', 'Bookmarks Menu',
      '收藏夹栏', '其他收藏夹',
    ])
    const scopeRootIds = new Set<number>()
    const rootFolders = db.prepare('SELECT id, name FROM folders WHERE user_id = ? AND parent_id IS NULL').all(userId) as { id: number; name: string }[]
    for (const rf of rootFolders) {
      if (containerFolderNames.has(rf.name)) {
        scopeRootIds.add(rf.id)
      }
    }

    // 收集作用域内所有文件夹 ID
    const scopeIds = new Set<number>()
    function collectDescendants(parentId: number) {
      scopeIds.add(parentId)
      const children = db.prepare('SELECT id FROM folders WHERE parent_id = ? AND user_id = ?').all(parentId, userId) as { id: number }[]
      for (const child of children) collectDescendants(child.id)
    }
    for (const rootId of scopeRootIds) collectDescendants(rootId)

    // 删除作用域内不受保护的文件夹
    const toDelete = [...scopeIds].filter(id => !protectedIds.has(id))
    if (toDelete.length > 0) {
      const deletePlaceholders = toDelete.map(() => '?').join(',')
      db.prepare(`UPDATE folders SET parent_id = NULL WHERE id IN (${deletePlaceholders})`).run(...toDelete)
      db.prepare(`DELETE FROM folders WHERE id IN (${deletePlaceholders})`).run(...toDelete)
    }
  })
  tx()

  return { success: true, added, updated, deleted, foldersCreated, total: bookmarks.length }
})
