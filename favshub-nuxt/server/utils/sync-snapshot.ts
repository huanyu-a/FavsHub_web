import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { normalizeUrl } from './bookmark-labels'

export interface SyncSnapshotFolder {
  id: number
  name: string
  parent_id: number | null
  sort_order: number
}

export interface SyncSnapshotBookmark {
  id: number
  title: string
  url: string
  folder_id: number | null
  container: string
  sort_order: number
  label: string
  source: string
}

export interface UserSyncSnapshot {
  folders: SyncSnapshotFolder[]
  bookmarks: SyncSnapshotBookmark[]
  /** 纯公共池书签保护的文件夹及祖先；不暴露公共池书签内容。 */
  pool_protected_folder_ids: number[]
  revision: string
}

export interface SyncPoolRevisionBookmark {
  id: number
  url: string
  folder_id: number | null
  icon?: string | null
}

export interface SyncRevisionOptions {
  userId?: number
  poolBookmarks?: SyncPoolRevisionBookmark[]
  bookmarkIcons?: { id: number; icon: string | null; url?: string }[]
}

function normalizeFolder(row: SyncSnapshotFolder): SyncSnapshotFolder {
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    parent_id: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
    sort_order: Number(row.sort_order) || 0,
  }
}

function normalizeBookmark(row: SyncSnapshotBookmark): SyncSnapshotBookmark {
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    url: normalizeUrl(String(row.url ?? '')),
    folder_id: row.folder_id === null || row.folder_id === undefined ? null : Number(row.folder_id),
    container: String(row.container ?? ''),
    sort_order: Number(row.sort_order) || 0,
    label: String(row.label ?? ''),
    source: String(row.source ?? ''),
  }
}

export function expandSyncFolderProtection(
  folders: SyncSnapshotFolder[],
  bookmarkFolderIds: Iterable<number>,
): number[] {
  const folderMap = new Map(folders.map(folder => [folder.id, folder]))
  const protectedIds = new Set<number>()
  for (const initialId of bookmarkFolderIds) {
    let folderId: number | null = initialId
    const visited = new Set<number>()
    while (folderId !== null && !protectedIds.has(folderId) && !visited.has(folderId)) {
      visited.add(folderId)
      protectedIds.add(folderId)
      folderId = folderMap.get(folderId)?.parent_id ?? null
    }
  }
  return [...protectedIds].sort((a, b) => a - b)
}

/** 仅纳入会改变同步结果的字段，键顺序与行顺序固定。 */
export function computeSyncRevision(
  input: Omit<UserSyncSnapshot, 'revision'>,
  options: SyncRevisionOptions = {},
): string {
  const folders = input.folders.map(normalizeFolder).sort((a, b) => a.id - b.id)
  const bookmarks = input.bookmarks.map(normalizeBookmark).sort((a, b) => a.id - b.id)
  const poolProtected = [...new Set(input.pool_protected_folder_ids.map(Number))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const privatePoolState = (options.poolBookmarks || []).map(row => ({
    id: Number(row.id),
    url: normalizeUrl(String(row.url ?? '')),
    raw_url: String(row.url ?? ''),
    folder_id: row.folder_id === null || row.folder_id === undefined ? null : Number(row.folder_id),
    icon: row.icon === null || row.icon === undefined ? null : String(row.icon),
  })).sort((a, b) => a.id - b.id)
  const bookmarkIcons = (options.bookmarkIcons || []).map(row => ({
    id: Number(row.id),
    icon: row.icon === null || row.icon === undefined ? null : String(row.icon),
    raw_url: row.url === undefined ? undefined : String(row.url),
  })).sort((a, b) => a.id - b.id)
  return createHash('sha256').update(JSON.stringify({
    version: 4,
    user_id: Number(options.userId) || 0,
    folders,
    bookmarks,
    pool_protected_folder_ids: poolProtected,
    // 以下隐藏状态仅参与服务端 digest，不进入 snapshot 响应。
    pool_bookmarks: privatePoolState,
    bookmark_icons: bookmarkIcons,
  })).digest('hex')
}

export function getUserSyncSnapshot(db: Database.Database, userId: number): UserSyncSnapshot {
  const folders = (db.prepare(
    'SELECT id, name, parent_id, sort_order FROM folders WHERE user_id = ? ORDER BY id ASC',
  ).all(userId) as SyncSnapshotFolder[]).map(normalizeFolder)

  // 管理员也严格读取自己的个人书签；不因角色切换到公共池或其他用户。
  const personalRows = db.prepare(
    `SELECT id, title, url, folder_id, container, sort_order, label, source, icon
     FROM bookmarks
     WHERE user_id = ? AND COALESCE(label, '') != ''
     ORDER BY id ASC`,
  ).all(userId) as (SyncSnapshotBookmark & { icon: string | null })[]
  const bookmarks = personalRows.map(normalizeBookmark)

  const poolFolderIds = (db.prepare(
    `SELECT DISTINCT folder_id FROM bookmarks
     WHERE user_id = ? AND COALESCE(label, '') = '' AND folder_id IS NOT NULL`,
  ).all(userId) as { folder_id: number }[]).map(row => Number(row.folder_id))
  const poolProtected = expandSyncFolderProtection(folders, poolFolderIds)
  // null folder 或已被其他书签保护的 folder 也会影响碰撞 upsert，必须纳入 revision。
  const poolBookmarks = db.prepare(
    `SELECT id, url, folder_id, icon FROM bookmarks
     WHERE user_id = ? AND COALESCE(label, '') = '' ORDER BY id ASC`,
  ).all(userId) as SyncPoolRevisionBookmark[]

  const snapshot = { folders, bookmarks, pool_protected_folder_ids: poolProtected }
  return {
    ...snapshot,
    revision: computeSyncRevision(snapshot, {
      userId,
      poolBookmarks,
      bookmarkIcons: personalRows.map(row => ({ id: row.id, icon: row.icon, url: row.url })),
    }),
  }
}
