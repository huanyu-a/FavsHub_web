/**
 * POST /api/sync/bookmarks — 全量替换同步
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
      const result = options.createFolder.run(options.userId, segment, currentParentId, 1, options.now, options.now)
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

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin
  // 普通用户同步的书签/文件夹强制为私有（login_required=1）
  const loginRequired = isAdmin ? 0 : 1

  const insertBookmark = db.prepare('INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order, login_required, container, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const findFolder = db.prepare('SELECT id FROM folders WHERE user_id = ? AND name = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))')
  const createFolder = db.prepare('INSERT INTO folders (user_id, name, parent_id, sort_order, login_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')

  const folderCache = new Map<string, number>()
  const ensureFolderPath = (path: string | null) => resolveFolderPath(path, {
    userId, findFolder, createFolder, folderCache, now,
  })

  const tx = db.transaction(() => {
    // 全量替换：先删除该用户所有书签
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(userId)
    // 清理该用户所有文件夹（先解除 FK 引用）
    db.prepare('UPDATE folders SET parent_id = NULL WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM folders WHERE user_id = ?').run(userId)

    for (const bm of bookmarks) {
      // folder_path 纯粹表达文件夹层级（不含容器名）
      const folderId = ensureFolderPath(bm.folder_path || bm.folder || null)
      // container 独立字段：bar / other / mobile
      const container = bm.container || ''
      insertBookmark.run(userId, bm.title, bm.url, folderId, bm.icon || null, bm.sort_order || 0, loginRequired, container, 'browser', now, now)
    }
  })
  tx()

  return { success: true, count: bookmarks.length }
})
