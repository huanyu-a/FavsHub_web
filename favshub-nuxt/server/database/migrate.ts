/**
 * 数据库迁移逻辑
 * 包含：表创建、增量迁移（ensureColumn）、索引、系统用户、默认搜索引擎
 */
import type Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { SYSTEM_CONFIG_DEFAULTS } from '../utils/constants'

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

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
  `)
}

/**
 * 增量迁移工具：检测列是否存在，不存在则添加
 */
function ensureColumn(db: Database.Database, table: string, column: string, alterSQL: string) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
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
  ensureColumn(db, 'bookmarks', 'source', "ALTER TABLE bookmarks ADD COLUMN source TEXT DEFAULT ''")
  ensureColumn(db, 'folders', 'updated_at', 'ALTER TABLE folders ADD COLUMN updated_at INTEGER')
  ensureColumn(db, 'users', 'nickname', "ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''")
  ensureColumn(db, 'bookmarks', 'login_required', 'ALTER TABLE bookmarks ADD COLUMN login_required INTEGER DEFAULT 0')
  ensureColumn(db, 'prompts', 'login_required', 'ALTER TABLE prompts ADD COLUMN login_required INTEGER DEFAULT 0')
  ensureColumn(db, 'search_engines', 'user_id', "ALTER TABLE search_engines ADD COLUMN user_id INTEGER DEFAULT 0")
  ensureColumn(db, 'prompt_folders', 'sort_order', 'ALTER TABLE prompt_folders ADD COLUMN sort_order INTEGER DEFAULT 0')
  ensureColumn(db, 'folders', 'login_required', 'ALTER TABLE folders ADD COLUMN login_required INTEGER DEFAULT 0')
  ensureColumn(db, 'prompt_folders', 'login_required', 'ALTER TABLE prompt_folders ADD COLUMN login_required INTEGER DEFAULT 0')
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
    `)
  } catch (err: any) {
    console.error('[DB] 创建性能索引失败:', err.message)
  }
}

/**
 * 初始化系统用户和默认数据
 */
export function seedDefaults(db: Database.Database) {
  // 系统用户 (id=0)，用于存储全局默认设置
  db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash, is_admin) VALUES (0, ?, ?, 1)').run('_system', '')
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = 0').run()

  // 1号管理员 admin_favs — 首次部署时预置（默认密码 admin123，请尽快修改）
  const adminHash = bcrypt.hashSync('admin123', 10)
  db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash, is_admin, nickname) VALUES (1, ?, ?, 1, ?)').run('admin_favs', adminHash, '管理员')

  // 系统默认设置行 (user_id=0)
  db.prepare('INSERT OR IGNORE INTO settings (user_id, data) VALUES (0, ?)').run('{}')

  // 初始化 system_config 默认值 + 从 settings 迁移旧 TDK 数据
  migrateSystemConfig(db)

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
对每个问题标注严重程度（🔴严重 / 🟡建议 / 🟢优化），给出具体行号和修改方案。`,
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
 * 执行完整的数据库初始化
 */
export function initializeDatabase(db: Database.Database) {
  createTables(db)
  runMigrations(db)
  createIndexes(db)
  seedDefaults(db)
}
