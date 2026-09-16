/**
 * 数据库迁移逻辑
 * 包含：表创建、增量迁移（ensureColumn）、索引、系统用户、默认搜索引擎
 */
import type Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_CONFIG_DEFAULTS } from '../utils/constants'
import { seedDefaultCollections } from '../utils/seed-collections'
import { seedDefaultTokenDeals } from '../utils/seed-token-deals'

/**
 * `bookmarks.has_sync` 生成列的**单点定义**，供两处共用：
 *   1. `ALTER TABLE bookmarks ADD COLUMN ...`（补列）
 *   2. `CREATE TABLE bookmarks_new (...)`（重建表时必须带上，否则该列被丢弃）
 * 必须是 VIRTUAL —— SQLite 的 ALTER TABLE ADD COLUMN 不支持 STORED 生成列。
 */
const HAS_SYNC_COLUMN_SQL = `has_sync INTEGER GENERATED ALWAYS AS (
  CASE WHEN source LIKE '%"sync"%' THEN 1 ELSE 0 END
) VIRTUAL`

/**
 * 初始化 Schema — 创建所有基础表（如不存在）
 */
export function createTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES folders(id)
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      folder_id INTEGER,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (folder_id) REFERENCES folders(id)
    );

    CREATE TABLE IF NOT EXISTS prompt_folders (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      folder_id TEXT,
      is_favorite INTEGER DEFAULT 0,
      version_count INTEGER DEFAULT 0,
      current_version TEXT DEFAULT '1.0.0',
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (folder_id) REFERENCES prompt_folders(id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS prompt_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL,
      content TEXT NOT NULL,
      version_number TEXT NOT NULL,
      created_at INTEGER,
      FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER PRIMARY KEY,
      data TEXT DEFAULT '{}',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS search_engines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      label TEXT,
      url TEXT NOT NULL,
      icon TEXT,
      category TEXT DEFAULT 'SEARCH',
      sort_order INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS prompt_review_requests (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_comment TEXT,
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      reviewed_by INTEGER,
      FOREIGN KEY (prompt_id) REFERENCES prompts(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      meta_title TEXT DEFAULT '',
      meta_description TEXT DEFAULT '',
      meta_keywords TEXT DEFAULT '',
      is_public INTEGER DEFAULT 0,
      is_official INTEGER DEFAULT 0,
      bookmark_count INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collection_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES collection_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collection_bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id TEXT NOT NULL,
      bookmark_id INTEGER NOT NULL,
      category_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES collection_categories(id) ON DELETE SET NULL,
      UNIQUE(collection_id, bookmark_id)
    );

    CREATE TABLE IF NOT EXISTS collection_subscriptions (
      user_id INTEGER NOT NULL,
      collection_id TEXT NOT NULL,
      subscribed_at INTEGER,
      PRIMARY KEY (user_id, collection_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collection_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      collection_id TEXT NOT NULL,
      collection_bookmark_id INTEGER NOT NULL,
      bookmark_id INTEGER NOT NULL,
      imported_at INTEGER,
      UNIQUE(user_id, collection_id, collection_bookmark_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_bookmark_id) REFERENCES collection_bookmarks(id) ON DELETE CASCADE,
      FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS token_deals (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      call_url TEXT DEFAULT '',
      quota TEXT DEFAULT '',
      models TEXT DEFAULT '[]',
      region TEXT DEFAULT 'cn',
      quality TEXT DEFAULT '中品',
      source_tag TEXT DEFAULT 'official',
      expires_at INTEGER,
      pinned INTEGER DEFAULT 0,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      reject_reason TEXT DEFAULT '',
      vote_up INTEGER DEFAULT 0,
      vote_down INTEGER DEFAULT 0,
      rating_sum INTEGER DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS token_deal_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      vote TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(deal_id, user_id),
      FOREIGN KEY (deal_id) REFERENCES token_deals(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS token_deal_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(deal_id, user_id),
      FOREIGN KEY (deal_id) REFERENCES token_deals(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `)
}

/**
 * 增量迁移工具：检测列是否存在，不存在则添加
 * 用 table_xinfo 而非 table_info —— 后者**不返回生成列**，
 * 若将来用本函数添加生成列，判断会恒为 false 导致每次启动重复 ALTER。
 */
function ensureColumn(db: Database.Database, table: string, column: string, alterSQL: string) {
  try {
    const cols = db.prepare(`PRAGMA table_xinfo(${table})`).all() as { name: string }[]
    if (!cols.some(c => c.name === column)) {
      db.exec(alterSQL)
      console.log(`[DB] 迁移: ${table} 表添加 ${column} 字段`)
    }
  } catch (err: any) {
    console.error(`[DB] 迁移失败 ${table}.${column}:`, err.message)
  }
}

/**
 * 执行所有增量迁移
 */
export function runMigrations(db: Database.Database) {
  ensureColumn(db, 'tags', 'color', "ALTER TABLE tags ADD COLUMN color TEXT DEFAULT ''")
  ensureColumn(db, 'tags', 'updated_at', 'ALTER TABLE tags ADD COLUMN updated_at INTEGER')
  ensureColumn(db, 'prompt_tags', 'created_at', 'ALTER TABLE prompt_tags ADD COLUMN created_at INTEGER')
  ensureColumn(db, 'prompts', 'avatar', "ALTER TABLE prompts ADD COLUMN avatar TEXT DEFAULT ''")
  ensureColumn(db, 'prompt_folders', 'parent_id', 'ALTER TABLE prompt_folders ADD COLUMN parent_id TEXT')
  ensureColumn(db, 'prompt_folders', 'icon', "ALTER TABLE prompt_folders ADD COLUMN icon TEXT DEFAULT ''")
  ensureColumn(db, 'folders', 'icon', "ALTER TABLE folders ADD COLUMN icon TEXT DEFAULT ''")
  ensureColumn(db, 'prompt_versions', 'variables', "ALTER TABLE prompt_versions ADD COLUMN variables TEXT DEFAULT ''")
  ensureColumn(db, 'bookmarks', 'container', "ALTER TABLE bookmarks ADD COLUMN container TEXT DEFAULT ''")
  ensureColumn(db, 'bookmarks', 'updated_at', 'ALTER TABLE bookmarks ADD COLUMN updated_at INTEGER')
  ensureColumn(db, 'bookmarks', 'source', "ALTER TABLE bookmarks ADD COLUMN source TEXT DEFAULT '[]'")
  ensureColumn(db, 'folders', 'updated_at', 'ALTER TABLE folders ADD COLUMN updated_at INTEGER')
  ensureColumn(db, 'users', 'nickname', "ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''")
  ensureColumn(db, 'bookmarks', 'login_required', 'ALTER TABLE bookmarks ADD COLUMN login_required INTEGER DEFAULT 0')
  ensureColumn(db, 'prompts', 'login_required', 'ALTER TABLE prompts ADD COLUMN login_required INTEGER DEFAULT 0')
  ensureColumn(db, 'search_engines', 'user_id', "ALTER TABLE search_engines ADD COLUMN user_id INTEGER DEFAULT 0")
  ensureColumn(db, 'prompt_folders', 'sort_order', 'ALTER TABLE prompt_folders ADD COLUMN sort_order INTEGER DEFAULT 0')
  ensureColumn(db, 'folders', 'login_required', 'ALTER TABLE folders ADD COLUMN login_required INTEGER DEFAULT 0')
  ensureColumn(db, 'prompt_folders', 'login_required', 'ALTER TABLE prompt_folders ADD COLUMN login_required INTEGER DEFAULT 0')
  ensureColumn(db, 'search_engines', 'status', "ALTER TABLE search_engines ADD COLUMN status TEXT DEFAULT 'approved'")
  ensureColumn(db, 'prompts', 'usage_count', 'ALTER TABLE prompts ADD COLUMN usage_count INTEGER DEFAULT 0')
  ensureColumn(db, 'prompts', 'deleted_at', 'ALTER TABLE prompts ADD COLUMN deleted_at INTEGER DEFAULT NULL')
  ensureColumn(db, 'prompt_versions', 'change_note', "ALTER TABLE prompt_versions ADD COLUMN change_note TEXT DEFAULT ''")
  ensureColumn(db, 'collections', 'meta_title', "ALTER TABLE collections ADD COLUMN meta_title TEXT DEFAULT ''")
  ensureColumn(db, 'collections', 'meta_description', "ALTER TABLE collections ADD COLUMN meta_description TEXT DEFAULT ''")
  ensureColumn(db, 'collections', 'meta_keywords', "ALTER TABLE collections ADD COLUMN meta_keywords TEXT DEFAULT ''")
  ensureColumn(db, 'collection_bookmarks', 'category_id', 'ALTER TABLE collection_bookmarks ADD COLUMN category_id INTEGER')

  // 删除旧的 category_name 列（SQLite 需要重建表）
  try {
    const cols = db.prepare('PRAGMA table_info(collection_bookmarks)').all() as { name: string }[]
    if (cols.some(c => c.name === 'category_name')) {
      console.log('[DB] 迁移: collection_bookmarks 表从 category_name 迁移到 category_id')
      db.exec(`
        CREATE TABLE collection_bookmarks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          collection_id TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          icon TEXT DEFAULT '',
          description TEXT DEFAULT '',
          category_id INTEGER,
          sort_order INTEGER DEFAULT 0,
          created_at INTEGER,
          FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES collection_categories(id) ON DELETE SET NULL
        );
        INSERT INTO collection_bookmarks_new (id, collection_id, title, url, icon, description, sort_order, created_at)
        SELECT id, collection_id, title, url, icon, description, sort_order, created_at FROM collection_bookmarks;
        DROP TABLE collection_bookmarks;
        ALTER TABLE collection_bookmarks_new RENAME TO collection_bookmarks;
      `)
    }
  } catch (err: any) {
    console.error('[DB] 迁移 collection_bookmarks 失败:', err.message)
  }

  // 添加 has_sync 虚拟列和索引
  // 注意 1：SQLite 的 ALTER TABLE ADD COLUMN 只支持 VIRTUAL 生成列，
  //         写成 STORED 会报 "cannot add a STORED column" 而永久失败（VIRTUAL 列同样可建索引）。
  // 注意 2：必须用 PRAGMA table_xinfo 判断列是否存在 —— table_info 不返回生成列，
  //         用它判断会恒为 false，导致每次启动都重复 ALTER（错误被下方 catch 静默吞掉）。
  // 注意 3：列定义取自 HAS_SYNC_COLUMN_SQL，重建 bookmarks 表的分支（见下方 entry_id 迁移）
  //         必须复用同一常量，否则重建后该列丢失、索引创建再次失败。
  try {
    const cols = db.prepare('PRAGMA table_xinfo(bookmarks)').all() as { name: string }[]
    if (!cols.some(c => c.name === 'has_sync')) {
      db.exec(`ALTER TABLE bookmarks ADD COLUMN ${HAS_SYNC_COLUMN_SQL}`)
      console.log('[DB] 迁移: bookmarks 表添加 has_sync 虚拟列')
    }
  } catch (err: any) {
    if (!err.message.includes('duplicate column name')) {
      console.error('[DB] 迁移失败 bookmarks.has_sync:', err.message)
    }
  }

  // 更新已有 bookmarks 的 source 字段：将空字符串改为 []
  try {
    const needUpdate = db.prepare("SELECT COUNT(*) as c FROM bookmarks WHERE source = ''").get() as { c: number }
    if (needUpdate.c > 0) {
      db.prepare("UPDATE bookmarks SET source = '[]' WHERE source = ''").run()
      console.log(`[DB] 迁移: 已更新 ${needUpdate.c} 条书签的 source 字段为 '[]'`)
    }
  } catch (err: any) {
    console.error('[DB] 迁移 bookmarks.source 失败:', err.message)
  }

  // ─── migrate to simplified architecture (bookmark_id + label) ───
  try {
    const bcols = db.prepare('PRAGMA table_info(bookmarks)').all() as { name: string }[]

    // 1. Add missing columns
    if (!bcols.some(c => c.name === 'label')) {
      // A5: NOT NULL DEFAULT '' — 保证 b.label != '' 查询与复合索引对全行生效
      db.exec("ALTER TABLE bookmarks ADD COLUMN label TEXT NOT NULL DEFAULT ''")
      console.log('[DB] migrate: added bookmarks.label (NOT NULL DEFAULT \'\')')
    }
    if (!bcols.some(c => c.name === 'description')) {
      db.exec("ALTER TABLE bookmarks ADD COLUMN description TEXT DEFAULT ''")
      console.log('[DB] migrate: added bookmarks.description')
    }
    if (!bcols.some(c => c.name === 'need_proxy')) {
      db.exec("ALTER TABLE bookmarks ADD COLUMN need_proxy INTEGER DEFAULT 0")
      console.log('[DB] migrate: added bookmarks.need_proxy')
    }

    // 2. Rebuild bookmarks without entry_id FK, add description + label
    if (bcols.some(c => c.name === 'entry_id')) {
      console.log('[DB] migrate: rebuilding bookmarks (add description, label, need_proxy, drop entry_id)')
      db.exec(`
        CREATE TABLE bookmarks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          folder_id INTEGER REFERENCES folders(id),
          icon TEXT,
          description TEXT DEFAULT '',
          sort_order INTEGER DEFAULT 0,
          container TEXT DEFAULT '',
          source TEXT DEFAULT '[]',
          login_required INTEGER DEFAULT 0,
          label TEXT NOT NULL DEFAULT '',
          need_proxy INTEGER DEFAULT 0,
          created_at INTEGER,
          updated_at INTEGER,
          ${HAS_SYNC_COLUMN_SQL},
          UNIQUE(user_id, url)
        );
        INSERT INTO bookmarks_new SELECT id, user_id, title, url, folder_id, icon, '', sort_order, container, source, login_required, COALESCE(label, ''), 0, created_at, updated_at FROM bookmarks;
        DROP TABLE bookmarks;
        ALTER TABLE bookmarks_new RENAME TO bookmarks;
      `)
      // Now safe to drop bookmark_entries (FKs are gone)
      db.exec('DROP TABLE IF EXISTS bookmark_entries')
      console.log('[DB] migrate: bookmarks rebuilt, bookmark_entries dropped')
    }

    // 3. Migrate collection_bookmarks: entry_id → bookmark_id
    const cbcols = db.prepare('PRAGMA table_info(collection_bookmarks)').all() as { name: string }[]
    if (cbcols.some(c => c.name === 'entry_id')) {
      console.log('[DB] migrate: collection_bookmarks entry_id → bookmark_id')
      db.exec(`
        CREATE TABLE collection_bookmarks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
          category_id INTEGER REFERENCES collection_categories(id) ON DELETE SET NULL,
          sort_order INTEGER DEFAULT 0,
          created_at INTEGER,
          UNIQUE(collection_id, bookmark_id)
        );
        INSERT INTO collection_bookmarks_new (id, collection_id, bookmark_id, category_id, sort_order, created_at)
        SELECT cb.id, cb.collection_id, cb.entry_id, cb.category_id, cb.sort_order, cb.created_at
        FROM collection_bookmarks cb;
        DROP TABLE collection_bookmarks;
        ALTER TABLE collection_bookmarks_new RENAME TO collection_bookmarks;
      `)
      console.log('[DB] migrate: collection_bookmarks uses bookmark_id')
    }

    // 4. 回填历史个人书签 label（仅非管理员；管理员 label='' 表示公共池，禁止改写）
    // 规则：label 为空 且 非管理员 → 视为个人；admin 的空 label 保留为公共池
    try {
      const r = db.prepare(`
        UPDATE bookmarks
        SET label = CASE
          WHEN container IS NOT NULL AND container != '' THEN 'sync'
          WHEN source = 'web' THEN 'web'
          WHEN source = 'sync' OR source LIKE '%"sync"%' THEN 'sync'
          ELSE 'personal'
        END
        WHERE COALESCE(label, '') = ''
          AND user_id NOT IN (SELECT id FROM users WHERE is_admin = 1)
      `).run()
      if (r.changes > 0) {
        console.log(`[DB] migrate: backfilled label on ${r.changes} personal bookmarks`)
      }
    } catch (err: any) {
      console.warn('[DB] migrate label backfill skipped:', err.message)
    }

    // 5. 归一化历史 NULL label → ''（早期版本 label 可空，存量行可能为 NULL，
    //    b.label != '' 查询与复合索引对 NULL 行不生效）
    try {
      const nullLabels = db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE label IS NULL').get() as { c: number }
      if (nullLabels.c > 0) {
        db.prepare("UPDATE bookmarks SET label = '' WHERE label IS NULL").run()
        console.log(`[DB] migrate: 已将 ${nullLabels.c} 条书签的 NULL label 归一化为 ''`)
      }
    } catch { /* 表或列不存在时忽略 */ }
  } catch (e: any) {
    console.error('[DB] migrate simplified arch failed:', e.message)
  }

  // D1: 存量库重建 folders / prompt_folders，使 user_id 外键带 ON DELETE CASCADE
  ensureFkCascade(db)
}

/**
 * D1: 为已有库补上 folders / prompt_folders 的 user_id 外键 ON DELETE CASCADE。
 * 新库由 createTables 直接声明；存量库需重建表（SQLite 无法 ALTER 外键动作）。
 * 失败时仅记录日志，不影响启动——管理员删除用户仍由集中清理函数显式删除各表数据。
 */
function ensureFkCascade(db: Database.Database) {
  try {
    const needsRebuild = (table: string, from: string): boolean => {
      const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as { from: string; on_delete: string }[]
      return fks.some(f => f.from === from && f.on_delete !== 'CASCADE')
    }
    const rebuildFolders = needsRebuild('folders', 'user_id')
    const rebuildPromptFolders = needsRebuild('prompt_folders', 'user_id')
    if (!rebuildFolders && !rebuildPromptFolders) return

    const wasOn = (db.pragma('foreign_keys', { simple: true }) as number) === 1
    db.pragma('foreign_keys = OFF')
    try {
      if (rebuildFolders) {
        db.exec(`
          CREATE TABLE folders_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            parent_id INTEGER REFERENCES folders(id),
            sort_order INTEGER DEFAULT 0,
            icon TEXT DEFAULT '',
            login_required INTEGER DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER
          );
          INSERT INTO folders_new (id, user_id, name, parent_id, sort_order, icon, login_required, created_at, updated_at)
            SELECT id, user_id, name, parent_id, COALESCE(sort_order, 0), COALESCE(icon, ''), COALESCE(login_required, 0), created_at, updated_at FROM folders;
          DROP TABLE folders;
          ALTER TABLE folders_new RENAME TO folders;
        `)
        console.log('[DB] 迁移: folders.user_id 外键已加 ON DELETE CASCADE')
      }
      if (rebuildPromptFolders) {
        db.exec(`
          CREATE TABLE prompt_folders_new (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            parent_id TEXT,
            icon TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            login_required INTEGER DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER
          );
          INSERT INTO prompt_folders_new (id, user_id, name, parent_id, icon, sort_order, login_required, created_at, updated_at)
            SELECT id, user_id, name, parent_id, COALESCE(icon, ''), COALESCE(sort_order, 0), COALESCE(login_required, 0), created_at, updated_at FROM prompt_folders;
          DROP TABLE prompt_folders;
          ALTER TABLE prompt_folders_new RENAME TO prompt_folders;
        `)
        console.log('[DB] 迁移: prompt_folders.user_id 外键已加 ON DELETE CASCADE')
      }
    } finally {
      if (wasOn) db.pragma('foreign_keys = ON')
    }
  } catch (err: any) {
    console.error('[DB] 迁移外键 CASCADE 失败（忽略，仍由集中删除逻辑兜底）:', err.message)
  }
}

/**
 * 创建索引（唯一索引 + 性能索引）
 */
export function createIndexes(db: Database.Database) {
  // 清理旧索引
  try { db.exec('DROP INDEX IF EXISTS idx_bookmarks_user_url_folder') } catch { /* 忽略 */ }

  // 唯一索引：URL 去重
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_url ON bookmarks(user_id, url)')
  } catch (err: any) {
    console.warn('[DB] URL 去重索引创建失败，正在清理重复书签...', err.message)
    db.exec(`
      DELETE FROM bookmarks WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM bookmarks GROUP BY user_id, url
      )
    `)
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_url ON bookmarks(user_id, url)')
    console.log('[DB] 重复书签清理完成')
  }

  // 性能索引
  // D9: 先清理 prompt_tags 重复关联，避免下方 UNIQUE 索引创建失败
  try {
    db.exec(`
      DELETE FROM prompt_tags WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM prompt_tags GROUP BY prompt_id, tag_id
      )
    `)
  } catch { /* 表不存在时忽略 */ }
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_folder_id ON bookmarks(folder_id);
      /* C4: 首页书签列表 WHERE user_id+login_required+label!='' ORDER BY created_at DESC 的覆盖索引 */
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user_label_created ON bookmarks(user_id, login_required, label, created_at);
      /* D10/A9: 增量同步时间范围查询 — since.get.ts 用 COALESCE(updated_at, created_at)，
         单列 updated_at 索引无法命中，改为用户维度表达式索引 */
      DROP INDEX IF EXISTS idx_bookmarks_updated_at;
      CREATE INDEX IF NOT EXISTS idx_bookmarks_updated_at ON bookmarks(user_id, (COALESCE(updated_at, created_at)));
      CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
      CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
      CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id);
      CREATE INDEX IF NOT EXISTS idx_prompts_folder_id ON prompts(folder_id);
      CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_tags_prompt_id ON prompt_tags(prompt_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag_id ON prompt_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_folders_user_id ON prompt_folders(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_tags_unique ON prompt_tags(prompt_id, tag_id);
      CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
      CREATE INDEX IF NOT EXISTS idx_collections_public ON collections(is_public, is_official);
      CREATE INDEX IF NOT EXISTS idx_cc_collection ON collection_categories(collection_id);
      CREATE INDEX IF NOT EXISTS idx_cc_parent ON collection_categories(parent_id);
      CREATE INDEX IF NOT EXISTS idx_cb_collection ON collection_bookmarks(collection_id);
      /* M8: 精选集书签排序索引 — 服务 admin/collections/[id]/bookmarks 的 ORDER BY sort_order；
         前台详情查询按 JOIN 的 folders 列 COALESCE 排序，该索引无法覆盖 */
      CREATE INDEX IF NOT EXISTS idx_cb_collection_sort ON collection_bookmarks(collection_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_cb_category ON collection_bookmarks(category_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cb_collection_bookmark ON collection_bookmarks(collection_id, bookmark_id);
      CREATE INDEX IF NOT EXISTS idx_cs_user ON collection_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_ci_user_collection ON collection_imports(user_id, collection_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_unique ON collection_imports(user_id, collection_id, collection_bookmark_id);
      /* D2: 搜索引擎公开查询按 status='approved' 过滤，status 作前导列 */
      DROP INDEX IF EXISTS idx_search_engines_category;
      CREATE INDEX IF NOT EXISTS idx_search_engines_category ON search_engines(status, category, sort_order);
      /* Token 白嫖通告：列表默认 WHERE status='approved' ORDER BY pinned DESC, created_at DESC */
      CREATE INDEX IF NOT EXISTS idx_td_status ON token_deals(status, pinned, created_at);
      CREATE INDEX IF NOT EXISTS idx_td_user ON token_deals(user_id);
      CREATE INDEX IF NOT EXISTS idx_td_region ON token_deals(region, quality);
      CREATE INDEX IF NOT EXISTS idx_tdv_deal ON token_deal_votes(deal_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tdv_unique ON token_deal_votes(deal_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_tdr_deal ON token_deal_reviews(deal_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tdr_unique ON token_deal_reviews(deal_id, user_id);
    `)
  } catch (err: any) {
    console.error('[DB] 创建性能索引失败:', err.message)
  }

  // has_sync 索引单独创建并容错。
  // 历史背景：该列曾用 ALTER TABLE ADD COLUMN ... STORED 创建而永久失败；
  // 而这条 CREATE INDEX 原本排在上方多语句 exec 块的第 3 条，
  // 一失败即中断整块 → 其后 33 条语句（含 31 条 CREATE INDEX）全部未执行，
  // 其中 15 条索引在本库实际缺失（另 16 条早已存在，属幂等无害）。
  // 独立 try/catch 保证单点失败不再连累其余索引。
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_bookmarks_has_sync ON bookmarks(user_id, has_sync)')
  } catch (err: any) {
    console.warn('[DB] idx_bookmarks_has_sync 创建失败（不影响其他索引）:', err.message)
  }
}

/**
 * 初始化系统用户和默认数据
 */
export function seedDefaults(db: Database.Database) {
  // 系统用户 (id=0)，用于存储全局默认设置
  // password_hash 为空字符串是设计意图：系统用户不用于登录，无密码 hash 可防止被误用
  db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash, is_admin) VALUES (0, ?, ?, 1)').run('_system', '')
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = 0').run()

  // 1号管理员 admin_favs — 首次部署时随机生成密码，打印到控制台
  // 使用 INSERT OR IGNORE 确保仅首次创建；若已存在则跳过
  const existingAdmin = db.prepare('SELECT id FROM users WHERE id = 1').get()
  if (!existingAdmin) {
    // 首次部署：生成随机密码（排除易混字符）
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    let randomPassword = ''
    const buf = randomBytes(16)
    for (let i = 0; i < 12; i++) {
      randomPassword += charset[buf[i] % charset.length]
    }
    const adminHash = bcrypt.hashSync(randomPassword, 10)
    db.prepare('INSERT INTO users (id, username, password_hash, is_admin, nickname) VALUES (1, ?, ?, 1, ?)').run('admin_favs', adminHash, '管理员')

    // 将初始密码写入文件（仅 root 可读），避免明文打印到 stdout 被日志采集
    try {
      const passwordFile = join(process.cwd(), 'data', '.initial-password')
      writeFileSync(passwordFile, `admin_favs:${randomPassword}\n`, { mode: 0o600 })
      console.log('═══════════════════════════════════════════════════')
      console.log('[Security] 初始管理员账号已创建')
      console.log('[Security]   用户名: admin_favs')
      console.log(`[Security]   密码已写入: ${passwordFile}`)
      console.log('[Security] 请立即登录并修改密码。')
      console.log('═══════════════════════════════════════════════════')
    } catch {
      // 文件写入失败时回退到控制台输出（开发环境安全）
      console.log('═══════════════════════════════════════════════════')
      console.log('[Security] 初始管理员账号已创建')
      console.log('[Security]   用户名: admin_favs')
      console.log(`[Security]   密码: ${randomPassword}`)
      console.log('[Security] 请立即登录并修改密码，此密码仅显示一次。')
      console.log('═══════════════════════════════════════════════════')
    }
  }

  // 系统默认设置行 (user_id=0)
  db.prepare('INSERT OR IGNORE INTO settings (user_id, data) VALUES (0, ?)').run('{}')

  // 初始化 system_config 默认值 + 从 settings 迁移旧 TDK 数据
  migrateSystemConfig(db)

  // 历史 emoji 图标一次性迁移为 Remix Icon 类名
  migrateEmojiIcons(db)

  // 历史 Google s2 远程图标一次性本地化 + 修正旧默认 favicon 源
  migrateGoogleIcons(db)

  // 如果没有任何管理员，将第一个用户设为管理员
  const adminCount = (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 1').get() as { c: number }).c
  if (adminCount === 0) {
    const firstUser = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as { id: number } | undefined
    if (firstUser) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(firstUser.id)
      console.log(`[DB] 已将第一个用户 (ID: ${firstUser.id}) 设为管理员`)
    }
  }

  // 默认搜索引擎（如果表为空）
  const engineCount = (db.prepare('SELECT COUNT(*) as c FROM search_engines').get() as { c: number }).c
  if (engineCount === 0) {
    seedDefaultSearchEngines(db)
  }

  // 默认提示词（如果表为空）
  const promptCount = (db.prepare('SELECT COUNT(*) as c FROM prompts').get() as { c: number }).c
  if (promptCount === 0) {
    seedDefaultPrompts(db)
  }

  // 默认精选集（如果表为空）
  const collectionCount = (db.prepare('SELECT COUNT(*) as c FROM collections').get() as { c: number }).c
  if (collectionCount === 0) {
    seedDefaultCollections(db)
  }

  // 默认 Token 白嫖通告（如果表为空）
  const tokenDealCount = (db.prepare('SELECT COUNT(*) as c FROM token_deals').get() as { c: number }).c
  if (tokenDealCount === 0) {
    seedDefaultTokenDeals(db)
  }
}

/**
 * 一次性迁移：历史 emoji 图标值 → Remix Icon 类名
 *
 * IconPicker 旧版允许在文件夹/提示词文件夹/精选集的 icon 字段存 emoji，
 * 新版界面已全面使用 Remix Icon。常见 emoji 按语义映射为对应图标，
 * 未收录的 emoji 统一清空（前端用 fallback 图标兜底）。
 * 以 system_config 标记位保证只跑一次，迁移后用户仍可重新自选图标。
 */
function migrateEmojiIcons(db: Database.Database) {
  const EMOJI_RE = /\p{Extended_Pictographic}/u

  const MARKER = 'emoji_icons_migrated'
  const done = db.prepare("SELECT value FROM system_config WHERE key = ?").get(MARKER)
  if (done) return

  const EMOJI_MAP: Record<string, string> = {
    '🤖': 'ri-robot-2-line', '🌐': 'ri-global-line', '🛠️': 'ri-tools-line', '🛠': 'ri-tools-line',
    '🎨': 'ri-palette-line', '💻': 'ri-computer-line', '📚': 'ri-book-2-line', '💼': 'ri-briefcase-line',
    '☁️': 'ri-cloud-line', '☁': 'ri-cloud-line', '🎬': 'ri-movie-line', '💾': 'ri-save-3-line',
    '🎮': 'ri-gamepad-line', '📊': 'ri-bar-chart-grouped-line', '🏠': 'ri-home-5-line',
    '📣': 'ri-megaphone-line', '🛡️': 'ri-shield-check-line', '🛡': 'ri-shield-check-line',
    '📁': 'ri-folder-line', '📂': 'ri-folder-open-line', '📄': 'ri-file-line', '📝': 'ri-file-list-line',
    '🔧': 'ri-tools-line', '⚙️': 'ri-settings-line', '⚙': 'ri-settings-line', '⏱️': 'ri-time-line',
    '⏱': 'ri-time-line', '⚽': 'ri-football-line', '✉️': 'ri-mail-line', '✉': 'ri-mail-line',
    '✍️': 'ri-edit-line', '✍': 'ri-edit-line', '✏️': 'ri-pencil-line', '✏': 'ri-pencil-line',
    '✨': 'ri-sparkling-line', '🌊': 'ri-water-flash-line', '🔥': 'ri-fire-line', '⭐': 'ri-star-line',
    '🔗': 'ri-link-m', '💡': 'ri-lightbulb-line', '🎵': 'ri-music-line', '📷': 'ri-camera-line',
    '🛒': 'ri-shopping-cart-line', '💰': 'ri-money-cny-circle-line', '📈': 'ri-line-chart-line',
    '🧪': 'ri-test-tube-line', '🔒': 'ri-lock-line', '🔑': 'ri-key-2-line', '🚀': 'ri-rocket-line',
    '🌱': 'ri-plant-line', '🍃': 'ri-leaf-line', '☁': 'ri-cloud-line',
  }

  const targets = [
    { table: 'folders' },
    { table: 'prompt_folders' },
    { table: 'collections' },
  ]

  let migratedCount = 0
  for (const { table } of targets) {
    try {
      const rows = db.prepare(`SELECT id, icon FROM ${table} WHERE icon IS NOT NULL AND icon != ''`).all() as { id: any; icon: string }[]
      const update = db.prepare(`UPDATE ${table} SET icon = ? WHERE id = ?`)
      for (const row of rows) {
        if (!EMOJI_RE.test(row.icon)) continue
        const mapped = EMOJI_MAP[row.icon.trim()] || ''
        update.run(mapped, row.id)
        migratedCount++
      }
    } catch (e) {
      console.warn(`[DB] emoji 图标迁移跳过表 ${table}: ${e instanceof Error ? e.message : e}`)
    }
  }

  db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)')
    .run(MARKER, String(Date.now()), Date.now())
  if (migratedCount > 0) {
    console.log(`[DB] 已将 ${migratedCount} 条历史 emoji 图标迁移为 Remix Icon`)
  }
}

/**
 * 一次性迁移：Google s2 远程图标 URL → 本地路径 /images/favicons/{hostname}.png
 *
 * 旧版导入/下载逻辑把 icon 存成 https://www.google.com/s2/favicons?domain=...，
 * 该源国内被墙导致图标永远加载失败。迁移为本地路径后，
 * 缺失文件的域名由 /api/favicon 代理按 favicon_source_url 自动补下。
 * 同时将仍在使用旧 Google 默认值的 favicon_source_url 配置修正为当前默认源。
 */
function migrateGoogleIcons(db: Database.Database) {
  const MARKER = 'google_icons_localized'
  const done = db.prepare('SELECT value FROM system_config WHERE key = ?').get(MARKER)
  if (done) return

  const rows = db.prepare(
    "SELECT id, url FROM bookmarks WHERE icon LIKE 'https://www.google.com/s2/favicons?%'"
  ).all() as { id: any; url: string }[]

  const update = db.prepare('UPDATE bookmarks SET icon = ? WHERE id = ?')
  let migratedCount = 0
  for (const row of rows) {
    try {
      const hostname = new URL(row.url).hostname
      // 与下载端点相同的净化规则，防止非法字符进入路径
      const safeHostname = hostname.replace(/[^a-zA-Z0-9.-]/g, '')
      if (!safeHostname || safeHostname.includes('..')) continue
      update.run(`/images/favicons/${safeHostname}.png`, row.id)
      migratedCount++
    } catch { /* 无效 URL 保留原值 */ }
  }

  // 修正仍为旧 Google 默认值的 favicon 源配置（用户自定义过的值不动）
  try {
    const cfg = db.prepare("SELECT value FROM system_config WHERE key = 'favicon_source_url'").get() as { value: string } | undefined
    if (!cfg || cfg.value.includes('google.com/s2/favicons')) {
      db.prepare("UPDATE system_config SET value = ?, updated_at = ? WHERE key = 'favicon_source_url'")
        .run('https://favicon.im/{domain}', Date.now())
    }
  } catch { /* system_config 可能尚未建表，忽略 */ }

  db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)')
    .run(MARKER, String(Date.now()), Date.now())
  if (migratedCount > 0) {
    console.log(`[DB] 已将 ${migratedCount} 条 Google s2 远程图标迁移为本地路径`)
  }
}

/**
 * 初始化/迁移 system_config 表数据
 * 将 settings user_id=0 中的 TDK 和系统配置字段迁移到独立表
 */
function migrateSystemConfig(db: Database.Database) {
  const defaults: Record<string, string> = { ...SYSTEM_CONFIG_DEFAULTS }

  const upsert = db.prepare(
    'INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)'
  )

  // 先插入默认值（如不存在）
  for (const [k, v] of Object.entries(defaults)) {
    upsert.run(k, v)
  }

  // 百度统计 ID（如不存在则写入初始值，管理员可在后台修改）
  upsert.run('baidu_tongji_id', 'cbab65f7d4752af37d29b48bcbf3c646')
  // 百度统计域名白名单（如不存在则写入，管理员可在后台修改）
  upsert.run('baidu_tongji_domains', '')

  // 从 settings user_id=0 迁移旧数据（仅首次）
  const row = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as { data: string } | undefined
  if (row) {
    try {
      const old = JSON.parse(row.data) as Record<string, any>
      const migrateKeys = Object.keys(defaults)
      let migrated = false
      for (const k of migrateKeys) {
        if (k in old && old[k] !== undefined && old[k] !== '') {
          const val = String(old[k])
          db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)').run(
            k, val, Date.now()
          )
          delete old[k]
          migrated = true
        }
      }
      // 清理 settings 中已迁移的字段
      if (migrated) {
        db.prepare('UPDATE settings SET data = ? WHERE user_id = 0').run(JSON.stringify(old))
        console.log('[DB] 已将 TDK/系统配置从 settings 迁移到 system_config')
      }
    } catch { /* 解析失败忽略 */ }
  }
}

/**
 * 插入 28 个默认搜索引擎
 */
function seedDefaultSearchEngines(db: Database.Database) {
  const insertEngine = db.prepare(
    'INSERT INTO search_engines (name, label, url, icon, category, sort_order, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )

  const defaultEngines: [string, string, string, string, string, number, number][] = [
    ['google', '谷歌', 'https://www.google.com/search?q=%s', '/images/google-logo.svg', 'SEARCH', 1, 1],
    ['bing', '必应', 'https://www.bing.com/search?q=%s', '/images/bing-logo.png', 'SEARCH', 2, 1],
    ['baidu', '百度', 'https://www.baidu.com/s?wd=%s', '/images/baidu-logo.svg', 'SEARCH', 3, 1],
    ['baidu_m', '百度移动', 'https://m.baidu.com/s?wd=%s', '/images/baidu-logo.svg', 'SEARCH', 4, 0],
    ['toutiao', '头条', 'https://so.toutiao.com/search?dvpf=pc&keyword=%s', '/images/toutiao-logo.png', 'SEARCH', 5, 0],
    ['sougou', '搜狗', 'https://www.sogou.com/web?query=%s', '/images/sougou-logo.png', 'SEARCH', 6, 0],
    ['360', '360', 'https://www.so.com/s?q=%s', '/images/360-logo.png', 'SEARCH', 7, 0],
    ['shenma', '神马', 'https://yz.m.sm.cn/s?q=%s', '/images/shenma-logo.png', 'SEARCH', 8, 0],
    ['duckduckgo', 'DuckDuckGo', 'https://duckduckgo.com/?q=%s', '/images/duckduckgo-logo.svg', 'SEARCH', 9, 0],
    ['yahoo', '雅虎', 'https://search.yahoo.com/search?p=%s', '/images/yahoo-logo.svg', 'SEARCH', 10, 0],
    ['yandex', 'Yandex', 'https://yandex.com/search/?text=%s', '/images/yandex-logo.svg', 'SEARCH', 11, 0],
    ['chatgpt', 'ChatGPT', 'https://chat.openai.com/?q=%s', '/images/chatgpt-logo.svg', 'AI', 1, 1],
    ['claude', 'Claude', 'https://claude.ai/?q=%s', '/images/claude-logo.svg', 'AI', 2, 0],
    ['perplexity', 'Perplexity', 'https://www.perplexity.ai/?q=%s', '/images/perplexity-logo.svg', 'AI', 3, 0],
    ['kimi', 'Kimi', 'https://kimi.moonshot.cn/?q=%s', '/images/kimi-logo.svg', 'AI', 4, 0],
    ['doubao', '豆包', 'https://www.doubao.com/?q=%s', '/images/doubao-logo.png', 'AI', 5, 0],
    ['zhida', '知乎直答', 'https://zhida.zhihu.com/search?q=%s', '/images/zhida-logo.png', 'AI', 6, 0],
    ['qwen', '千问', 'https://www.qianwen.com/chat/?q=%s', '/images/qwen-logo.png', 'AI', 7, 0],
    ['deepseek', 'Deepseek', 'https://chat.deepseek.com/?q=%s', '/images/deepseek-logo.svg', 'AI', 8, 0],
    ['grok', 'Grok', 'https://grok.com/?q=%s', '/images/grok-logo.svg', 'AI', 9, 0],
    ['metaso', '秘塔', 'https://metaso.cn/?q=%s', '/images/metaso-logo.png', 'AI', 10, 0],
    ['felo', 'Felo', 'https://felo.ai/search?q=%s', '/images/felo-logo.svg', 'AI', 11, 0],
    ['semanticscholar', 'Semantic', 'https://www.semanticscholar.org/search?q=%s', '/images/semanticscholar-logo.png', 'AI', 12, 0],
    ['xiaohongshu', '小红书', 'https://www.xiaohongshu.com/search_result?keyword=%s', '/images/xiaohongshu-logo.svg', 'SOCIAL', 1, 0],
    ['jike', '即刻', 'https://web.okjike.com/search?keyword=%s', '/images/jike-logo.svg', 'SOCIAL', 2, 0],
    ['zhihu', '知乎', 'https://www.zhihu.com/search?q=%s', '/images/zhihu-logo.svg', 'SOCIAL', 3, 0],
    ['douban', '豆瓣', 'https://www.douban.com/search?q=%s', '/images/douban-logo.svg', 'SOCIAL', 4, 0],
    ['bilibili', '哔哩哔哩', 'https://search.bilibili.com/all?keyword=%s', '/images/bilibili-logo.svg', 'SOCIAL', 5, 0],
    ['github', 'GitHub', 'https://github.com/search?q=%s', '/images/github-logo.svg', 'SOCIAL', 6, 0],
  ]

  const insertMany = db.transaction((engines: typeof defaultEngines) => {
    for (const e of engines) insertEngine.run(...e)
  })
  insertMany(defaultEngines)
  console.log(`[DB] 已插入 ${defaultEngines.length} 个默认搜索引擎`)
}

/**
 * 插入 3 条默认提示词（含文件夹 + 初始版本）
 */
function seedDefaultPrompts(db: Database.Database) {
  const now = Date.now()
  const folderId = `${now}_default`
  const userId = 1 // admin

  // 创建默认文件夹
  db.prepare(
    'INSERT OR IGNORE INTO prompt_folders (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(folderId, userId, '默认', now, now)

  const inserts = [
    {
      id: `${now}_001`,
      title: '代码审查助手',
      description: '对代码进行专业审查，发现潜在问题并给出优化建议',
      content: `你是一名资深代码审查专家，精通多种编程语言和软件工程最佳实践。

## 任务
请对以下代码进行全面的 Code Review，从以下维度分析：

1. **正确性** — 逻辑是否正确，边界条件是否处理到位
2. **安全性** — 是否存在 SQL 注入、XSS、敏感信息泄露等安全漏洞
3. **性能** — 是否有不必要的循环、重复计算、内存泄漏
4. **可读性** — 命名是否清晰、结构是否合理、注释是否恰当
5. **最佳实践** — 是否符合该语言/框架的惯用写法

## 输出格式
对每个问题标注严重程度（严重 / 建议 / 优化），给出具体行号和修改方案。`,
      tags: '编程,代码审查,开发工具',
    },
    {
      id: `${now}_002`,
      title: '中英翻译专家',
      description: '高质量中英文互译，保持专业术语准确和语境自然',
      content: `你是一名专业的中英双语翻译专家，擅长技术文档、商务文案和学术论文翻译。

## 翻译原则
- 忠实原文，不增不减核心信息
- 专业术语使用行业标准译法
- 中文翻译符合中文表达习惯，不出现"翻译腔"
- 英文翻译符合英语母语者表达习惯

## 输出格式
1. 先输出翻译结果
2. 然后列出关键术语对照表（如有）
3. 如有需要说明的翻译选择，简要注释

请开始翻译以下内容：`,
      tags: '翻译,语言工具,写作',
    },
    {
      id: `${now}_003`,
      title: 'API 文档生成器',
      description: '根据代码自动生成清晰的 API 接口文档',
      content: `你是一名技术文档撰写专家，擅长将代码转化为清晰易读的 API 文档。

## 文档规范
请为以下 API 接口生成文档，包含：

1. **接口概述** — 一句话描述功能
2. **请求信息**
   - Method & URL
   - Headers（含认证方式）
   - Body 参数（名称、类型、必填、说明、示例）
   - Query 参数（同上）
3. **响应信息**
   - 成功响应示例（JSON）
   - 错误响应示例
   - 状态码说明表
4. **调用示例** — cURL 或其他语言的请求示例
5. **注意事项** — 限流、幂等性、版本等特殊说明

## 输出格式
使用 Markdown 格式输出，结构清晰，便于直接复制到文档系统。`,
      tags: '开发工具,文档,API',
    },
  ]

  const insertPrompt = db.prepare(
    `INSERT OR IGNORE INTO prompts (id, user_id, title, description, content, folder_id, is_favorite, version_count, current_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertVersion = db.prepare(
    `INSERT OR IGNORE INTO prompt_versions (id, prompt_id, content, version_number, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )

  const insertAll = db.transaction(() => {
    for (const p of inserts) {
      insertPrompt.run(p.id, userId, p.title, p.description, p.content, folderId, 0, 1, '1.0.0', now, now)
      insertVersion.run(`${p.id}_v1`, p.id, p.content, '1.0.0', now)
    }
    // 创建 3 个标签
    const tags = ['编程', '翻译', '开发工具']
    for (const tagName of tags) {
      const tagId = `${now}_tag_${tagName}`
      db.prepare('INSERT OR IGNORE INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').run(tagId, userId, tagName, now)
      const tagObj = db.prepare('SELECT id FROM tags WHERE name = ? AND user_id = ?').get(tagName, userId) as { id: string } | undefined
      if (!tagObj) continue
      // 关联到对应的 prompt
      if (tagName === '编程') {
        db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)').run(inserts[0].id, tagObj.id, now)
      }
      if (tagName === '翻译') {
        db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)').run(inserts[1].id, tagObj.id, now)
      }
      if (tagName === '开发工具') {
        db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)').run(inserts[0].id, tagObj.id, now)
        db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)').run(inserts[2].id, tagObj.id, now)
      }
    }
  })
  insertAll()
  console.log(`[DB] 已插入 ${inserts.length} 条默认提示词`)
}

/**
 * 插入 3 个官方精选集
 */

/**
 * 执行完整的数据库初始化
 */
export function initializeDatabase(db: Database.Database) {
  createTables(db)
  runMigrations(db)
  createIndexes(db)
  seedDefaults(db)
}
