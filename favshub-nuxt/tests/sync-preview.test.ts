import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getUserSyncSnapshot } from '../server/utils/sync-snapshot'
import { previewSyncUpload } from '../server/utils/sync-upload-preview'
import { syncUploadBookmarks } from '../server/utils/sync-upload'

const databases: Database.Database[] = []
function createDb() {
  const db = new Database(':memory:')
  databases.push(db)
  db.exec(`
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
  return db
}

beforeEach(() => {
  vi.stubGlobal('createError', (input: Record<string, unknown>) => Object.assign(new Error('sync error'), input))
})

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function addFolder(db: Database.Database, userId: number, name: string, parentId: number | null = null) {
  return Number(db.prepare('INSERT INTO folders (user_id, name, parent_id) VALUES (?, ?, ?)').run(userId, name, parentId).lastInsertRowid)
}

function addBookmark(db: Database.Database, userId: number, url: string, options: {
  folderId?: number | null
  label?: string
  container?: string
  title?: string
} = {}) {
  return Number(db.prepare(
    'INSERT INTO bookmarks (user_id, title, url, folder_id, container, source, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(userId, options.title || url, url, options.folderId ?? null, options.container || 'bar', '[]', options.label ?? 'sync').lastInsertRowid)
}

describe('同步 snapshot 与 revision', () => {
  it('返回超过 500 条的个人全量数据，严格隔离其他用户和公共池', () => {
    const db = createDb()
    const ownFolder = addFolder(db, 1, '自己的文件夹')
    addFolder(db, 2, '其他用户文件夹')
    for (let i = 0; i < 650; i++) addBookmark(db, 1, `https://own.example/${i}`, { folderId: ownFolder })
    for (let i = 0; i < 3; i++) addBookmark(db, 2, `https://other.example/${i}`)
    addBookmark(db, 1, 'https://pool.example', { folderId: ownFolder, label: '' })
    addBookmark(db, 3, 'https://admin-personal.example', { label: 'sync' })
    addBookmark(db, 3, 'https://admin-pool.example', { label: '' })

    const snapshot = getUserSyncSnapshot(db, 1)
    expect(snapshot.bookmarks).toHaveLength(650)
    expect(snapshot.folders.map(folder => folder.id)).toEqual([ownFolder])
    expect(snapshot.bookmarks.every(bookmark => bookmark.url.startsWith('https://own.example/'))).toBe(true)
    expect(snapshot.pool_protected_folder_ids).toEqual([ownFolder])
    expect(snapshot.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(getUserSyncSnapshot(db, 1).revision).toBe(snapshot.revision)

    const adminSnapshot = getUserSyncSnapshot(db, 3)
    expect(adminSnapshot.bookmarks.map(bookmark => bookmark.url)).toEqual(['https://admin-personal.example'])
    expect(adminSnapshot.bookmarks.some(bookmark => bookmark.url.startsWith('https://own.example/'))).toBe(false)
  })
})

describe('PUT revision 事务保护', () => {
  it('revision 冲突返回 409 且书签和文件夹零写入', () => {
    const db = createDb()
    addBookmark(db, 1, 'https://before.example')
    const before = getUserSyncSnapshot(db, 1)
    let statusCode = 0
    try {
      syncUploadBookmarks(db, 1, {
        expected_revision: 'stale-revision',
        bookmarks: [{ title: '不应写入', url: 'https://after.example', folder_path: '不应建夹', container: 'bar' }],
      })
    } catch (error) {
      statusCode = (error as { statusCode?: number }).statusCode || 0
    }

    expect(statusCode).toBe(409)
    expect(db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM folders').get()).toEqual({ count: 0 })
    expect(getUserSyncSnapshot(db, 1).revision).toBe(before.revision)

    const result = syncUploadBookmarks(db, 1, {
      expected_revision: before.revision,
      bookmarks: [{ title: '正常写入', url: 'https://after.example', folder_path: '新文件夹', container: 'bar' }],
    })
    expect(result.added).toBe(1)
    expect(result.foldersCreated).toBe(1)
    expect(result.revision).toBe(getUserSyncSnapshot(db, 1).revision)
  })
})

describe('上传文件夹清理', () => {
  it('返回真实删除数，pool 降级和纯公共池仍保护文件夹及其祖先', () => {
    const db = createDb()
    const root = addFolder(db, 1, '书签栏')
    const personalFolder = addFolder(db, 1, '个人空夹', root)
    const emptyFolder = addFolder(db, 1, '真正空夹', root)
    const dualPoolFolder = addFolder(db, 1, '双属性保护', root)
    const publicPoolFolder = addFolder(db, 1, '公共池保护', root)
    addBookmark(db, 1, 'https://personal.example', { folderId: personalFolder, label: 'sync' })
    addBookmark(db, 1, 'https://dual.example', { folderId: dualPoolFolder, label: 'sync,pool' })
    addBookmark(db, 1, 'https://public.example', { folderId: publicPoolFolder, label: '' })

    const result = syncUploadBookmarks(db, 1, {
      bookmarks: [{ title: '新书签', url: 'https://new.example', container: 'bar' }],
    })

    expect(result.deleted).toBe(2)
    expect(result.foldersDeleted).toBe(2)
    const remaining = new Set((db.prepare('SELECT id FROM folders').all() as { id: number }[]).map(row => row.id))
    expect(remaining.has(personalFolder)).toBe(false)
    expect(remaining.has(emptyFolder)).toBe(false)
    expect(remaining.has(root)).toBe(true)
    expect(remaining.has(dualPoolFolder)).toBe(true)
    expect(remaining.has(publicPoolFolder)).toBe(true)
    expect(db.prepare("SELECT label FROM bookmarks WHERE url = 'https://dual.example'").get()).toEqual({ label: '' })
  })
})

describe('只读上传预览', () => {
  it('纯公共池碰撞与空夹删除计数精确，真实 DB 逐行和 revision 不变且响应无公共池 URL', () => {
    const db = createDb()
    const root = addFolder(db, 1, '书签栏')
    addBookmark(db, 1, 'https://private-pool.example', { folderId: root, label: '' })
    addFolder(db, 2, '其他用户文件夹')
    addBookmark(db, 2, 'https://other-user.example')
    const body = {
      bookmarks: [{
        title: '碰撞不应新增', url: 'https://private-pool.example',
        folder_path: '书签栏/临时空夹', container: 'bar',
      }],
    }
    const beforeFolders = db.prepare('SELECT * FROM folders ORDER BY id').all()
    const beforeBookmarks = db.prepare('SELECT * FROM bookmarks ORDER BY id').all()
    const beforeRevision = getUserSyncSnapshot(db, 1).revision

    const preview = previewSyncUpload(db, 1, body)
    expect(preview).toEqual({
      added: 0, updated: 0, deleted: 0,
      foldersCreated: 1, foldersDeleted: 1, revision: beforeRevision,
    })
    expect(JSON.stringify(preview)).not.toContain('private-pool.example')
    expect(db.prepare('SELECT * FROM folders ORDER BY id').all()).toEqual(beforeFolders)
    expect(db.prepare('SELECT * FROM bookmarks ORDER BY id').all()).toEqual(beforeBookmarks)
    expect(getUserSyncSnapshot(db, 1).revision).toBe(beforeRevision)

    const actual = syncUploadBookmarks(db, 1, { ...body, expected_revision: preview.revision })
    expect(actual).toMatchObject({
      added: preview.added, updated: preview.updated, deleted: preview.deleted,
      foldersCreated: preview.foldersCreated, foldersDeleted: preview.foldersDeleted,
    })
    expect(db.prepare("SELECT COUNT(*) AS count FROM folders WHERE name = '临时空夹'").get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM folders WHERE id = ?").get(root)).toEqual({ count: 1 })
  })

  it('650 条与其他用户/公共池数据完整参与克隆，预览不超过限制且不漂移', () => {
    const db = createDb()
    const ownFolder = addFolder(db, 1, '个人')
    const payload = []
    for (let i = 0; i < 650; i++) {
      const url = `https://own.example/${i}`
      addBookmark(db, 1, url, { folderId: ownFolder })
      payload.push({ title: `第 ${i} 条`, url, folder_path: '个人', container: 'bar' })
    }
    for (let i = 0; i < 5; i++) addBookmark(db, 2, `https://other.example/${i}`)
    addBookmark(db, 1, 'https://pool-only.example', { label: '' })
    payload.push({ title: '新增', url: 'https://new.example', container: 'bar' })

    const preview = previewSyncUpload(db, 1, { bookmarks: payload })
    expect(preview).toMatchObject({ added: 1, updated: 650, deleted: 0, foldersCreated: 0 })
    const actual = syncUploadBookmarks(db, 1, { bookmarks: payload, expected_revision: preview.revision })
    expect(actual).toMatchObject({
      added: preview.added, updated: preview.updated, deleted: preview.deleted,
      foldersCreated: preview.foldersCreated, foldersDeleted: preview.foldersDeleted,
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = 2').get()).toEqual({ count: 5 })
  })

  it('legacy URL 按规范化身份更新，保留原行、icon 与 collection source', () => {
    const db = createDb()
    addBookmark(db, 1, 'https://legacy.example/', { title: '旧标题' })
    db.prepare("UPDATE bookmarks SET icon = 'existing-icon', source = ? WHERE url = ?")
      .run(JSON.stringify(['collection:keep', 'other']), 'https://legacy.example/')
    const body = {
      bookmarks: [{ title: '新标题', url: ' https://legacy.example/// ', container: 'bar' }],
    }
    const preview = previewSyncUpload(db, 1, body)
    expect(preview).toMatchObject({ added: 0, updated: 1, deleted: 0 })
    const actual = syncUploadBookmarks(db, 1, { ...body, expected_revision: preview.revision })
    expect(actual).toMatchObject({ added: 0, updated: 1, deleted: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT url, title, icon, source FROM bookmarks').get()).toEqual({
      url: 'https://legacy.example/', title: '新标题', icon: 'existing-icon',
      source: JSON.stringify(['sync', 'collection:keep']),
    })
  })

  it('公共池精确 URL 与个人 legacy 变体共存时优先保留个人行', () => {
    const db = createDb()
    addBookmark(db, 1, 'https://legacy.example', { label: '' })
    addBookmark(db, 1, 'https://legacy.example/', { title: '旧标题' })
    db.prepare("UPDATE bookmarks SET icon = 'personal-icon', source = ? WHERE url = ?")
      .run(JSON.stringify(['collection:personal']), 'https://legacy.example/')
    const body = { bookmarks: [{ title: '个人新标题', url: 'https://legacy.example', container: 'bar' }] }

    const preview = previewSyncUpload(db, 1, body)
    expect(preview).toMatchObject({ added: 0, updated: 1, deleted: 0 })
    const actual = syncUploadBookmarks(db, 1, { ...body, expected_revision: preview.revision })
    expect(actual).toMatchObject({ added: 0, updated: 1, deleted: 0 })
    expect(db.prepare("SELECT title, icon, source FROM bookmarks WHERE url = 'https://legacy.example/'").get()).toEqual({
      title: '个人新标题', icon: 'personal-icon', source: JSON.stringify(['sync', 'collection:personal']),
    })
    expect(db.prepare("SELECT label FROM bookmarks WHERE url = 'https://legacy.example'").get()).toEqual({ label: '' })
  })

  it('重复 normalized URL 共同 last-wins，只创建最后路径且 total 保留输入条数', () => {
    const db = createDb()
    const body = {
      bookmarks: [
        { title: '第一版', url: 'https://same.example/', folder_path: '第一目录', container: 'bar' },
        { title: '最终版', url: ' https://same.example ', folder_path: '最终目录', container: 'bar' },
      ],
    }
    const preview = previewSyncUpload(db, 1, body)
    expect(preview).toMatchObject({ added: 1, updated: 0, foldersCreated: 1 })
    const actual = syncUploadBookmarks(db, 1, { ...body, expected_revision: preview.revision })
    expect(actual).toMatchObject({ added: 1, updated: 0, foldersCreated: 1, total: 2 })
    expect(db.prepare('SELECT title, url FROM bookmarks').get()).toEqual({ title: '最终版', url: 'https://same.example' })
    expect(db.prepare("SELECT COUNT(*) AS count FROM folders WHERE name = '第一目录'").get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM folders WHERE name = '最终目录'").get()).toEqual({ count: 1 })
  })

  it('隐藏公共池/null folder 与 icon 变化改变 revision，旧预期 409 且零写', () => {
    const db = createDb()
    addBookmark(db, 1, 'https://personal.example')
    db.prepare("UPDATE bookmarks SET icon = 'old-icon'").run()
    const before = previewSyncUpload(db, 1, {
      bookmarks: [{ title: '新书签', url: 'https://new.example', container: 'bar' }],
    })
    addBookmark(db, 1, 'https://hidden-pool.example', { label: '', folderId: null })
    expect(getUserSyncSnapshot(db, 1).revision).not.toBe(before.revision)
    expect(() => syncUploadBookmarks(db, 1, {
      expected_revision: before.revision,
      bookmarks: [{ title: '不应写入', url: 'https://new.example', container: 'bar' }],
    })).toThrow()

    const current = previewSyncUpload(db, 1, {
      bookmarks: [{ title: '个人更新', url: 'https://personal.example', container: 'bar' }],
    })
    db.prepare("UPDATE bookmarks SET icon = 'new-icon' WHERE url = 'https://personal.example'").run()
    expect(getUserSyncSnapshot(db, 1).revision).not.toBe(current.revision)
    expect(() => syncUploadBookmarks(db, 1, {
      expected_revision: current.revision,
      bookmarks: [{ title: '不应覆盖', url: 'https://personal.example', container: 'bar' }],
    })).toThrow()
    expect(db.prepare("SELECT icon FROM bookmarks WHERE url = 'https://personal.example'").get()).toEqual({ icon: 'new-icon' })
  })

  it('个人/公共池 raw-only URL 变化也作废旧 revision，新预览与真实结果一致', () => {
    const db = createDb()
    addBookmark(db, 1, 'https://raw-pool.example//', { label: '' })
    addBookmark(db, 1, 'https://raw-personal.example//', { title: '旧标题' })
    db.prepare("UPDATE bookmarks SET icon = 'keep-icon' WHERE url = 'https://raw-personal.example//'").run()
    const before = previewSyncUpload(db, 1, {
      bookmarks: [{ title: '不应写入', url: 'https://raw-personal.example', container: 'bar' }],
    })

    db.prepare("UPDATE bookmarks SET url = 'https://raw-pool.example' WHERE url = 'https://raw-pool.example//'").run()
    db.prepare("UPDATE bookmarks SET url = 'https://raw-personal.example/' WHERE url = 'https://raw-personal.example//'").run()
    expect(getUserSyncSnapshot(db, 1).revision).not.toBe(before.revision)
    expect(() => syncUploadBookmarks(db, 1, {
      expected_revision: before.revision,
      bookmarks: [{ title: '不应写入', url: 'https://raw-personal.example', container: 'bar' }],
    })).toThrow()
    expect(db.prepare("SELECT title FROM bookmarks WHERE url = 'https://raw-personal.example/'").get()).toEqual({ title: '旧标题' })

    const current = previewSyncUpload(db, 1, {
      bookmarks: [{ title: '新标题', url: 'https://raw-personal.example', container: 'bar' }],
    })
    const actual = syncUploadBookmarks(db, 1, {
      expected_revision: current.revision,
      bookmarks: [{ title: '新标题', url: 'https://raw-personal.example', container: 'bar' }],
    })
    expect(actual).toMatchObject({
      added: current.added, updated: current.updated, deleted: current.deleted,
      foldersCreated: current.foldersCreated, foldersDeleted: current.foldersDeleted,
    })
    expect(db.prepare("SELECT icon FROM bookmarks WHERE url = 'https://raw-personal.example/'").get()).toEqual({ icon: 'keep-icon' })
  })

  it('预览与 PUT 共享单次上限且超限真实 DB 零写', () => {
    const db = createDb()
    const bookmarks = Array.from({ length: 20001 }, (_, index) => ({
      title: String(index), url: `https://limit.example/${index}`, container: 'bar',
    }))
    const statusCodes: number[] = []
    for (const execute of [
      () => previewSyncUpload(db, 1, { bookmarks }),
      () => syncUploadBookmarks(db, 1, { bookmarks }),
    ]) {
      try { execute() } catch (error) {
        statusCodes.push((error as { statusCode?: number }).statusCode || 0)
      }
    }
    expect(statusCodes).toEqual([400, 400])
    expect(db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get()).toEqual({ count: 0 })
  })

  it('相同行数据的不同 userId 不产生相同 revision', () => {
    const first = createDb()
    const second = createDb()
    addBookmark(first, 7, 'https://same.example')
    addBookmark(second, 9, 'https://same.example')
    expect(getUserSyncSnapshot(first, 7).revision).not.toBe(getUserSyncSnapshot(second, 9).revision)
  })
})
