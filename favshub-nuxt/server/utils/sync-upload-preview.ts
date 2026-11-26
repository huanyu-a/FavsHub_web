import Database from 'better-sqlite3'
import { getUserSyncSnapshot } from './sync-snapshot'
import { syncUploadBookmarks, type SyncUploadBody, type SyncUploadResult } from './sync-upload'

export type SyncUploadPreview = Pick<
  SyncUploadResult,
  'added' | 'updated' | 'deleted' | 'foldersCreated' | 'foldersDeleted'
> & { revision: string }

const FOLDER_COLUMNS = 'id, user_id, name, parent_id, sort_order, created_at, updated_at'
const BOOKMARK_COLUMNS = 'id, user_id, title, url, folder_id, icon, sort_order, container, source, label, created_at, updated_at'

/**
 * 在真实库的只读一致快照上克隆当前用户完整同步状态，仅对 :memory: 执行 PUT 算法。
 * 返回原始 revision；模拟后的 nextRevision 不外泄，也不代表真实库已变化。
 */
export function previewSyncUpload(
  db: Database.Database,
  userId: number,
  body: SyncUploadBody,
): SyncUploadPreview {
  const source = db.transaction(() => {
    const revision = getUserSyncSnapshot(db, userId).revision
    const folders = db.prepare(
      `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = ? ORDER BY id ASC`,
    ).all(userId) as Record<string, unknown>[]
    // 不按 label 过滤：纯公共池碰撞必须参与精确预演，但只进入内存，不出接口。
    const bookmarks = db.prepare(
      `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks WHERE user_id = ? ORDER BY id ASC`,
    ).all(userId) as Record<string, unknown>[]
    return { revision, folders, bookmarks }
  })()
  const memory = new Database(':memory:')
  try {
    memory.exec(`
      CREATE TABLE folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        parent_id INTEGER,
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        folder_id INTEGER,
        icon TEXT,
        sort_order INTEGER DEFAULT 0,
        container TEXT DEFAULT '',
        source TEXT DEFAULT '[]',
        label TEXT NOT NULL DEFAULT '',
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(user_id, url)
      );
    `)
    const insertFolder = memory.prepare(`
      INSERT INTO folders (${FOLDER_COLUMNS})
      VALUES (@id, @user_id, @name, @parent_id, @sort_order, @created_at, @updated_at)
    `)
    const insertBookmark = memory.prepare(`
      INSERT INTO bookmarks (${BOOKMARK_COLUMNS})
      VALUES (@id, @user_id, @title, @url, @folder_id, @icon, @sort_order, @container, @source, @label, @created_at, @updated_at)
    `)
    memory.transaction(() => {
      for (const folder of source.folders) insertFolder.run(folder)
      for (const bookmark of source.bookmarks) insertBookmark.run(bookmark)
    })()

    const result = syncUploadBookmarks(memory, userId, {
      bookmarks: body?.bookmarks,
      force: body?.force,
    })
    return {
      added: result.added,
      updated: result.updated,
      deleted: result.deleted,
      foldersCreated: result.foldersCreated,
      foldersDeleted: result.foldersDeleted,
      revision: source.revision,
    }
  } finally {
    memory.close()
  }
}
