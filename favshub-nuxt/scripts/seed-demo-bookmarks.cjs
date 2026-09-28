/**
 * 本地演示数据种子：分类树 + 书签（label='demo'，login_required=0，管理员名下）
 * 游客可见（index.get.ts 游客分支：管理员 + login_required=0 + label != ''）。
 * 幂等：已存在 label='demo' 书签时直接退出。
 *
 * 用法（容器内）: node /tmp/seed-demo-bookmarks.cjs [db路径]
 */
const Database = require('/opt/favshub/.output/server/node_modules/better-sqlite3')

const DB_PATH = process.argv[2] || '/opt/favshub/data/favshub.db'
const LABEL = 'demo'

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── 确保管理员用户 ──
let admin = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get()
if (!admin) {
  const info = db
    .prepare("INSERT INTO users (username, email, password_hash, is_admin) VALUES ('admin', 'admin@local.test', '$2a$10$localdemoonlynotforlogin0000000000000000000000000000000000', 1)")
    .run()
  admin = { id: info.lastInsertRowid }
}
console.log('[seed] admin user_id =', admin.id)

// ── 幂等 ──
const existing = db.prepare('SELECT COUNT(*) AS c FROM bookmarks WHERE label = ?').get(LABEL)
if (existing.c > 0) {
  console.log('[seed] 已存在', existing.c, '条 demo 书签，跳过')
  process.exit(0)
}

// ── 分类树 ──
// [名称, 图标, 排序, 父分类名或 null]
const TREE = [
  ['AI 专区', '🤖', 10, null],
  ['聊天助手', '💬', 1, 'AI 专区'],
  ['AI 绘画', '🎨', 2, 'AI 专区'],
  ['开发编程', '💻', 20, null],
  ['前端框架', '🧩', 1, '开发编程'],
  ['设计专区', '✏️', 30, null],
  ['技术工具', '🛠️', 40, null],
  ['学习教育', '📚', 50, null],
  ['影音娱乐', '🎬', 60, null],
  ['效率办公', '💼', 70, null],
]

// [分类名, [书签...]]
const DATA = {
  聊天助手: [
    ['ChatGPT', 'https://chat.openai.com'],
    ['Claude', 'https://claude.ai'],
    ['Gemini', 'https://gemini.google.com'],
    ['Kimi', 'https://kimi.moonshot.cn'],
    ['DeepSeek', 'https://chat.deepseek.com'],
    ['豆包', 'https://www.doubao.com'],
    ['通义千问', 'https://tongyi.aliyun.com'],
  ],
  'AI 绘画': [
    ['Midjourney', 'https://www.midjourney.com'],
    ['LiblibAI', 'https://www.liblib.art'],
    ['Tensor.Art', 'https://tensor.art'],
    ['Recraft', 'https://www.recraft.ai'],
  ],
  前端框架: [
    ['Vue 3', 'https://vuejs.org'],
    ['Nuxt', 'https://nuxt.com'],
    ['Vite', 'https://vite.dev'],
    ['Tailwind CSS', 'https://tailwindcss.com'],
  ],
  开发编程: [
    ['GitHub', 'https://github.com'],
    ['Stack Overflow', 'https://stackoverflow.com'],
    ['MDN Web Docs', 'https://developer.mozilla.org'],
    ['npm', 'https://www.npmjs.com'],
    ['V2EX', 'https://v2ex.com'],
  ],
  设计专区: [
    ['Figma', 'https://www.figma.com'],
    ['Dribbble', 'https://dribbble.com'],
    ['Behance', 'https://www.behance.net'],
    ['iconfont', 'https://www.iconfont.cn'],
    ['Coolors', 'https://coolors.co'],
  ],
  技术工具: [
    ['Can I use', 'https://caniuse.com'],
    ['Regex101', 'https://regex101.com'],
    ['IT Tools', 'https://it-tools.tech'],
    ['Crontab.guru', 'https://crontab.guru'],
    ['Explainshell', 'https://explainshell.com'],
  ],
  学习教育: [
    ['Bilibili 学习区', 'https://www.bilibili.com'],
    ['Coursera', 'https://www.coursera.org'],
    ['freeCodeCamp', 'https://www.freecodecamp.org'],
    ['菜鸟教程', 'https://www.runoob.com'],
  ],
  影音娱乐: [
    ['YouTube', 'https://www.youtube.com'],
    ['网易云音乐', 'https://music.163.com'],
    ['豆瓣', 'https://www.douban.com'],
    ['Spotify', 'https://open.spotify.com'],
  ],
  效率办公: [
    ['Notion', 'https://www.notion.so'],
    ['飞书', 'https://www.feishu.cn'],
    ['腾讯文档', 'https://docs.qq.com'],
    ['ProcessOn', 'https://www.processon.com'],
    ['Excalidraw', 'https://excalidraw.com'],
  ],
}

const insFolder = db.prepare(
  'INSERT INTO folders (user_id, name, parent_id, sort_order, login_required) VALUES (?, ?, ?, ?, 0)',
)
const insBookmark = db.prepare(
  "INSERT INTO bookmarks (user_id, title, url, folder_id, sort_order, label, login_required) VALUES (?, ?, ?, ?, ?, 'demo', 0)",
)

const folderIds = {}
const seedAll = db.transaction(() => {
  for (const [name, icon, sort, parent] of TREE) {
    const parentId = parent ? folderIds[parent] : null
    const r = insFolder.run(admin.id, name, parentId, sort)
    folderIds[name] = r.lastInsertRowid
  }
  for (const [folder, marks] of Object.entries(DATA)) {
    marks.forEach(([title, url], i) => {
      insBookmark.run(admin.id, title, url, folderIds[folder], i + 1)
    })
  }
})
seedAll()

const counts = db
  .prepare(
    "SELECT (SELECT COUNT(*) FROM folders WHERE user_id = ?) AS folders, (SELECT COUNT(*) FROM bookmarks WHERE label = 'demo') AS bookmarks",
  )
  .get(admin.id)
console.log('[seed] done:', JSON.stringify(counts))
