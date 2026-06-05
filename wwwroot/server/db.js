const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'favshub.db');

// 确保 data 目录存在
const fs = require('fs');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const db = new Database(DB_PATH, { timeout: 10000 });

// 启用 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// 初始化 Schema
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
    FOREIGN KEY (user_id) REFERENCES users(id),
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
    FOREIGN KEY (user_id) REFERENCES users(id)
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
`);

// 初始化默认搜索引擎（如果表为空）
const engineCount = db.prepare('SELECT COUNT(*) as c FROM search_engines').get().c;
if (engineCount === 0) {
  const insertEngine = db.prepare('INSERT INTO search_engines (name, label, url, icon, category, sort_order, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const defaultEngines = [
    ['google', '谷歌', 'https://www.google.com/search?q=', '/images/google-logo.svg', 'SEARCH', 1, 1],
    ['bing', '必应', 'https://www.bing.com/search?q=', '/images/bing-logo.png', 'SEARCH', 2, 1],
    ['baidu', '百度', 'https://www.baidu.com/s?wd=', '/images/baidu-logo.svg', 'SEARCH', 3, 1],
    ['baidu_m', '百度移动', 'https://m.baidu.com/s?wd=', '/images/baidu-logo.svg', 'SEARCH', 4, 0],
    ['toutiao', '头条', 'https://so.toutiao.com/search?dvpf=pc&keyword=', '/images/toutiao-logo.png', 'SEARCH', 5, 0],
    ['sougou', '搜狗', 'https://www.sogou.com/web?query=', '/images/sougou-logo.png', 'SEARCH', 6, 0],
    ['360', '360', 'https://www.so.com/s?q=', '/images/360-logo.png', 'SEARCH', 7, 0],
    ['shenma', '神马', 'https://yz.m.sm.cn/s?q=', '/images/shenma-logo.png', 'SEARCH', 8, 0],
    ['duckduckgo', 'DuckDuckGo', 'https://duckduckgo.com/?q=', '/images/duckduckgo-logo.svg', 'SEARCH', 9, 0],
    ['yahoo', '雅虎', 'https://search.yahoo.com/search?p=', '/images/yahoo-logo.svg', 'SEARCH', 10, 0],
    ['yandex', 'Yandex', 'https://yandex.com/search/?text=', '/images/yandex-logo.svg', 'SEARCH', 11, 0],
    ['chatgpt', 'ChatGPT', 'https://chat.openai.com/?q=', '/images/chatgpt-logo.svg', 'AI', 1, 1],
    ['claude', 'Claude', 'https://claude.ai/?q=', '/images/claude-logo.svg', 'AI', 2, 0],
    ['perplexity', 'Perplexity', 'https://www.perplexity.ai/?q=', '/images/perplexity-logo.svg', 'AI', 3, 0],
    ['kimi', 'Kimi', 'https://kimi.moonshot.cn/?q=', '/images/kimi-logo.svg', 'AI', 4, 0],
    ['doubao', '豆包', 'https://www.doubao.com/?q=', '/images/doubao-logo.png', 'AI', 5, 0],
    ['zhida', '知乎直答', 'https://zhida.zhihu.com/search?q=', '/images/zhida-logo.png', 'AI', 6, 0],
    ['qwen', '千问', 'https://www.qianwen.com/chat/?q=', '/images/qwen-logo.png', 'AI', 7, 0],
    ['deepseek', 'Deepseek', 'https://chat.deepseek.com/?q=', '/images/deepseek-logo.svg', 'AI', 8, 0],
    ['grok', 'Grok', 'https://grok.com/?q=', '/images/grok-logo.svg', 'AI', 9, 0],
    ['metaso', '秘塔', 'https://metaso.cn/?q=', '/images/metaso-logo.png', 'AI', 10, 0],
    ['felo', 'Felo', 'https://felo.ai/search?q=', '/images/felo-logo.svg', 'AI', 11, 0],
    ['semanticscholar', 'Semantic', 'https://www.semanticscholar.org/search?q=', '/images/semanticscholar-logo.png', 'AI', 12, 0],
    ['xiaohongshu', '小红书', 'https://www.xiaohongshu.com/search_result?keyword=', '/images/xiaohongshu-logo.svg', 'SOCIAL', 1, 0],
    ['jike', '即刻', 'https://web.okjike.com/search?keyword=', '/images/jike-logo.svg', 'SOCIAL', 2, 0],
    ['zhihu', '知乎', 'https://www.zhihu.com/search?q=', '/images/zhihu-logo.svg', 'SOCIAL', 3, 0],
    ['douban', '豆瓣', 'https://www.douban.com/search?q=', '/images/douban-logo.svg', 'SOCIAL', 4, 0],
    ['bilibili', '哔哩哔哩', 'https://search.bilibili.com/all?keyword=', '/images/bilibili-logo.svg', 'SOCIAL', 5, 0],
    ['github', 'GitHub', 'https://github.com/search?q=', '/images/github-logo.svg', 'SOCIAL', 6, 0],
  ];
  const insertMany = db.transaction((engines) => { for (const e of engines) insertEngine.run(...e); });
  insertMany(defaultEngines);
}

// 迁移工具：使用 PRAGMA table_info 检测列是否存在（避免空表时遗漏迁移）
function ensureColumn(table, column, alterSQL) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(column)) {
      db.exec(alterSQL);
      console.log(`[DB] 迁移: ${table} 表添加 ${column} 字段`);
    }
  } catch (err) {
    console.error(`[DB] 迁移失败 ${table}.${column}:`, err.message);
  }
}

// 执行所有增量迁移
ensureColumn('tags', 'color', "ALTER TABLE tags ADD COLUMN color TEXT DEFAULT ''");
ensureColumn('tags', 'updated_at', 'ALTER TABLE tags ADD COLUMN updated_at INTEGER');
ensureColumn('prompt_tags', 'created_at', 'ALTER TABLE prompt_tags ADD COLUMN created_at INTEGER');
ensureColumn('prompts', 'avatar', "ALTER TABLE prompts ADD COLUMN avatar TEXT DEFAULT ''");
ensureColumn('prompt_folders', 'parent_id', 'ALTER TABLE prompt_folders ADD COLUMN parent_id TEXT');
ensureColumn('prompt_folders', 'icon', "ALTER TABLE prompt_folders ADD COLUMN icon TEXT DEFAULT ''");
ensureColumn('folders', 'icon', "ALTER TABLE folders ADD COLUMN icon TEXT DEFAULT ''");
ensureColumn('prompt_versions', 'variables', "ALTER TABLE prompt_versions ADD COLUMN variables TEXT DEFAULT ''");
ensureColumn('bookmarks', 'container', "ALTER TABLE bookmarks ADD COLUMN container TEXT DEFAULT ''");
ensureColumn('bookmarks', 'updated_at', 'ALTER TABLE bookmarks ADD COLUMN updated_at INTEGER');
ensureColumn('bookmarks', 'source', "ALTER TABLE bookmarks ADD COLUMN source TEXT DEFAULT ''");
ensureColumn('folders', 'updated_at', 'ALTER TABLE folders ADD COLUMN updated_at INTEGER');
ensureColumn('users', 'nickname', "ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''");
ensureColumn('bookmarks', 'login_required', 'ALTER TABLE bookmarks ADD COLUMN login_required INTEGER DEFAULT 0');
ensureColumn('prompts', 'login_required', 'ALTER TABLE prompts ADD COLUMN login_required INTEGER DEFAULT 0');

// 唯一索引：支持增量合并的 upsert 操作（以 url 为基准去重）
try {
  db.exec('DROP INDEX IF EXISTS idx_bookmarks_user_url_folder');
} catch (err) { /* 旧索引可能不存在 */ }
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_url ON bookmarks(user_id, url)');
} catch (err) {
  // 可能存在旧数据中的重复 URL，先清理再建索引
  console.warn('[DB] URL 去重索引创建失败，正在清理重复书签...', err.message);
  db.exec(`
    DELETE FROM bookmarks WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM bookmarks GROUP BY user_id, url
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_url ON bookmarks(user_id, url)');
  console.log('[DB] 重复书签清理完成');
}

// 性能索引：加速按 user_id 查询
try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_folder_id ON bookmarks(folder_id);
    CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
    CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id);
    CREATE INDEX IF NOT EXISTS idx_prompts_folder_id ON prompts(folder_id);
    CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_tags_prompt_id ON prompt_tags(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag_id ON prompt_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_folders_user_id ON prompt_folders(user_id);
  `);
} catch (err) {
  console.error('[DB] 创建性能索引失败:', err.message);
}

// 迁移：确保系统用户存在（id=0），用于存储全局默认设置
db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash, is_admin) VALUES (0, ?, ?, 1)').run('_system', '');
db.prepare('UPDATE users SET is_admin = 1 WHERE id = 0').run();

// 迁移：确保系统默认设置行存在（user_id=0）
db.prepare('INSERT OR IGNORE INTO settings (user_id, data) VALUES (0, ?)').run('{}');

// 迁移：如果没有任何管理员，将第一个用户设为管理员
const adminCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 1').get().c;
if (adminCount === 0) {
  const firstUser = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
  if (firstUser) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(firstUser.id);
    console.log('[DB] 已将第一个用户 (ID: ' + firstUser.id + ') 设为管理员');
  }
}

module.exports = db;
