#!/usr/bin/env node
/**
 * admin-auth-guard.mjs — 管理后台 API 的鉴权面（79 个端点，逐个打）
 *
 * ## 为什么单开一个套件
 *
 * `server/middleware/admin-guard.ts` **只保护页面**，文件头自己写着：
 *
 *   > 仅拦截 /admin 页面请求（排除 /api/ 和静态资源）
 *   > 管理员专属功能由各 API 端点的 requireAdmin() 和前端 v-if 控制
 *
 * 也就是说 `/api/admin/**` 这 79 个端点**没有任何统一入口把关**，全靠每个文件自己调鉴权 ——
 * 而它们是整个站里权限最高、也最危险的一批：删用户、改通告状态、清空提示词、重建精选集。
 * **漏掉一个 = 未鉴权的管理员操作**，且不会有任何东西提醒你。
 *
 * 静态扫描（「文件里有没有 requireAdmin」）不足以定案 —— 本套件的作者自己就被它骗了三次：
 *   1. 只查 `requireAdmin`，漏了 `isAdminUserById`（state.put.ts 用的是后者）；
 *   2. 只查 `requireAdmin`/`isAdminUser`，漏了 `getAuthRole`（23 个自身资源端点用它）；
 *   3. 用 `user_id\s*=` 找归属校验，漏了 `bookmark.user_id !== auth.id` 这种写法，
 *      于是把 5 个**其实是正确**的端点报成了「未见归属校验」。
 * 静态判据只认「长得像什么」，本套件改成**实际发请求看行为**。
 *
 * ## 断言三类
 *
 * | 类别 | 内容 |
 * |------|------|
 * | A 未登录 | 79 个端点全部必须 401/403。**鉴权必须发生在解析参数之前** —— 故意用非法 id，若先解析就会是 400/404，那说明闸门在参数之后 |
 * | B 越权（IDOR） | 普通用户动**别人的**书签/文件夹/提示词/提示词文件夹 → 403，**并且核对那一行还在**（不能只看状态码） |
 * | C 提权 | 普通用户改通告状态 / 把自己设成管理员 / 删用户 / 清空提示词 → 拒绝，**并核对库里没变** |
 *
 * ## 防「假绿」（这一类套件最容易自欺）
 *
 * 只断言「不是 2xx」有个致命漏洞：**如果探针的路径写错了，全都 404，也会全绿**。
 * 所以有两个正向对照：
 *   - **对照 1**：拿一个**公开**端点（`/api/announcements`）喂给同一个分类器，
 *     它必须被判定为「未鉴权就成功了」→ 证明分类器**能认出违规**，不是永远绿灯；
 *   - **对照 2**：以**管理员**身份访问若干端点必须 2xx → 证明路由与请求构造是对的，
 *     前面那些 401 不是「因为路径写错了才 401」。
 *
 * 用法：node scripts/admin-auth-guard.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3258
const BASE = `http://127.0.0.1:${APP_PORT}`

let pass = 0
const fails = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.error('  ✗', name, detail) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const PW_NORMAL = 'ProbeNormal123'
const PW_ADMIN = 'ProbeAdmin123'
const PW_VICTIM = 'ProbeVictim123'
const U = { normal: 'probe_normal_u', admin: 'probe_admin_u', victim: 'probe_victim_u' }
/** 非法 id：若鉴权发生在参数解析之前，响应就该是 401/403 而不是 400/404 */
const ABSENT = '__probe_absent__'

let dbPath = ''
let appProcess = null

// ── 枚举 /api/admin/** 端点（从文件系统读，代码增删自动跟上，不会失效）──
function enumerateAdminEndpoints() {
  const root = join(ROOT, 'server', 'api', 'admin')
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      const m = /^(.*)\.(get|post|put|patch|delete)\.ts$/.exec(name)
      if (!m) continue
      const rel = relative(join(ROOT, 'server', 'api'), p)
      // ⚠️ 两个必须做对的地方（我第一版都错了，82 条断言因此假红）：
      //   1. `server/api` 之后要补回 `/api` 前缀 —— 少了它请求会落到**页面**路由上，
      //      被 admin-guard 中间件 302 到 /login（那是页面守卫，不是 API 鉴权）；
      //   2. `index.get.ts` 映射到**目录路径**，不能带 `/index`。
      let route = '/api/' + rel.split(sep).join('/').replace(/\.(get|post|put|patch|delete)\.ts$/, '')
      route = route.replace(/\/index$/, '')
      // [id] / [...slug] 一律换成非法探针值
      route = route.replace(/\/\[[^\]]+\]/g, '/' + ABSENT)
      out.push({ method: m[2].toUpperCase(), route, file: relative(ROOT, p) })
    }
  }
  walk(root)
  out.sort((a, b) => (a.route + a.method).localeCompare(b.route + b.method))
  return out
}

function ensureNativeModule() {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  const load = () => { try { requireFromRoot('better-sqlite3'); return true } catch { return false } }
  if (!load()) {
    spawnSync('pnpm', ['rebuild', 'better-sqlite3'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (!load()) throw new Error('better-sqlite3 无法加载')
  }
}

async function startApp(dbPath) {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 pnpm build'); process.exit(1) }
  ensureNativeModule()
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), NUXT_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => console.error(`  [app] ${String(d).trim().slice(0, 300)}`))
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    try { const r = await fetch(`${BASE}/api/announcements`); if (r.ok) return } catch { /* 等就绪 */ }
    await sleep(500)
  }
  throw new Error('应用 30s 内未就绪')
}

/** 发一个请求，返回状态码与解析后的 JSON */
async function req(method, path, { cookie = '', body } = {}) {
  const headers = {}
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  let json = null
  const text = await res.text()
  try { json = JSON.parse(text) } catch { /* 非 JSON（如重定向页） */ }
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie?.() || [] }
}

async function login(username, password) {
  const r = await req('POST', '/api/auth/login', { body: { username, password } })
  if (r.status !== 200) throw new Error(`登录 ${username} 失败：status=${r.status} ${r.text.slice(0, 200)}`)
  const tok = (r.setCookie || []).find(c => c.startsWith('favshub_token='))
  if (!tok) throw new Error(`登录 ${username} 未拿到 favshub_token cookie`)
  return tok.split(';')[0]
}

/**
 * 分类器 —— 套件里唯一的「判决」出口。
 * 三个正向对照都要走它，保证「能认违规」这件事本身也被断言过。
 */
function classify(status, isAdminRoute) {
  if (status === 401 || status === 403) return 'guarded'
  if (status >= 200 && status < 300) return 'allowed'
  return 'other'   // 400/404/500 —— 闸门在参数之后，或端点根本没匹配到
}

try {
  mkdirSync(join(ROOT, 'data'), { recursive: true })
  dbPath = join(ROOT, 'data', `admin-auth-${Date.now()}.db`)
  const endpoints = enumerateAdminEndpoints()
  console.log(`▶ 启动应用（PORT=${APP_PORT}）｜枚举到 ${endpoints.length} 个 /api/admin 端点`)
  await startApp(dbPath)

  // ── 种数据：普通用户、管理员、以及「受害者」（他的资源用于越权测试）──
  const VICTIM_ROWS = {}
  {
    const requireFromRoot = createRequire(join(ROOT, 'package.json'))
    const Database = requireFromRoot('better-sqlite3')
    const bcrypt = requireFromRoot('bcryptjs')
    const db = new Database(dbPath)
    const mk = (hash) => bcrypt.hashSync(hash, 10)
    const now = Date.now()
    try {
      const insU = db.prepare('INSERT INTO users (username, email, password_hash, is_admin, created_at) VALUES (?,?,?,?,?)')
      const normalId = insU.run(U.normal, `${U.normal}@probe.test`, mk(PW_NORMAL), 0, now).lastInsertRowid
      const adminId = insU.run(U.admin, `${U.admin}@probe.test`, mk(PW_ADMIN), 1, now).lastInsertRowid
      const victimId = insU.run(U.victim, `${U.victim}@probe.test`, mk(PW_VICTIM), 0, now).lastInsertRowid
      VICTIM_ROWS.userId = Number(victimId)
      VICTIM_ROWS.normalId = Number(normalId)
      VICTIM_ROWS.adminId = Number(adminId)

      // 受害者名下的四类资源 —— 普通用户对它们做任何写操作都必须被拒。
      //
      // ⚠️ 主键类型不统一，照真实 DDL 来（我第一版按源码 migrate.ts 猜，被外键打回）：
      //    folders / bookmarks → INTEGER AUTOINCREMENT（用 lastInsertRowid）
      //    prompt_folders / prompts / prompt_versions → **TEXT 主键**（必须自己给 id，
      //      且 prompts.folder_id 是外键指向 prompt_folders(id)，传整数就 FOREIGN KEY failed）
      const folderId = db.prepare('INSERT INTO folders (user_id, name) VALUES (?,?)').run(victimId, 'victim-folder').lastInsertRowid
      const bookmarkId = db.prepare(
        'INSERT INTO bookmarks (user_id, folder_id, title, url, created_at) VALUES (?,?,?,?,?)',
      ).run(victimId, folderId, 'victim-bookmark', 'https://victim.example.com/', now).lastInsertRowid

      const PFOLDER = 'probe_pfolder_victim'
      const PROMPT = 'probe_prompt_victim'
      db.prepare('INSERT INTO prompt_folders (id, user_id, name, created_at) VALUES (?,?,?,?)')
        .run(PFOLDER, victimId, 'victim-pfolder', now)
      db.prepare('INSERT INTO prompts (id, user_id, title, content, folder_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(PROMPT, victimId, 'victim-prompt', 'victim-content', PFOLDER, now, now)
      db.prepare('INSERT INTO prompt_versions (id, prompt_id, content, version_number, created_at) VALUES (?,?,?,?,?)')
        .run('probe_pver_victim', PROMPT, 'victim-content-v1', '1.0.0', now)

      VICTIM_ROWS.folderId = Number(folderId)
      VICTIM_ROWS.bookmarkId = Number(bookmarkId)
      VICTIM_ROWS.promptFolderId = PFOLDER
      VICTIM_ROWS.promptId = PROMPT

      // 通告：受害者名下一条，普通用户自己也有一条（用于测「作者不能自审自过」）
      const insDeal = db.prepare(
        `INSERT INTO token_deals (id, user_id, provider, title, url, category, state, status,
          created_at, source_tag, quality)
         VALUES (?,?,?,?,?,?,?,?,?, 'community', '中品')`,
      )
      insDeal.run('probe_victim_deal', victimId, 'probe-victim-provider', '探针通告(受害者)',
        'https://victim.example.com/deal', 'token', 'pending', 'pending', now)
      insDeal.run('probe_own_deal', normalId, 'probe-own-provider', '探针通告(本人)',
        'https://normal.example.com/deal', 'token', 'pending', 'pending', now)
    } finally { db.close() }
  }

  const victimStillThere = (table, id) => {
    const requireFromRoot = createRequire(join(ROOT, 'package.json'))
    const Database = requireFromRoot('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    try { return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) } finally { db.close() }
  }
  const scalar = (sql, ...a) => {
    const requireFromRoot = createRequire(join(ROOT, 'package.json'))
    const Database = requireFromRoot('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    try { return db.prepare(sql).get(...a) } finally { db.close() }
  }

  const cookieNormal = await login(U.normal, PW_NORMAL)
  const cookieAdmin = await login(U.admin, PW_ADMIN)

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 防假绿 · 对照 1：分类器必须能认出「公开端点未鉴权即成功」')
  // ══════════════════════════════════════════════════════════════
  {
    const pub = await req('GET', '/api/announcements')
    check('分类器对公开端点 /api/announcements 判为 allowed（证明它能发现违规，不是永远绿灯）',
      classify(pub.status, false) === 'allowed', `status=${pub.status} → ${classify(pub.status, false)}`)
    const guarded = await req('GET', '/api/admin/users')
    check('分类器对未登录的 /api/admin/users 判为 guarded',
      classify(guarded.status, true) === 'guarded', `status=${guarded.status} → ${classify(guarded.status, true)}`)
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 防假绿 · 对照 2：以管理员身份访问必须成功（证明路由与请求构造正确）')
  // ══════════════════════════════════════════════════════════════
  {
    const positive = [
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/stats'],
      ['GET', '/api/admin/bookmarks'],
      ['GET', '/api/admin/folders'],
      ['GET', '/api/admin/token-deals/subscriptions'],
      ['GET', '/api/admin/backup/info'],
    ]
    for (const [m, p] of positive) {
      const r = await req(m, p, { cookie: cookieAdmin })
      check(`管理员访问 ${p} → 2xx（证明该路由真实存在、请求构造正确）`,
        r.status >= 200 && r.status < 300, `status=${r.status}`)
    }
  }

  // ══════════════════════════════════════════════════════════════
  console.log(`\n▶ A. 未登录访问全部 ${endpoints.length} 个 admin 端点 → 必须 401/403（鉴权须先于参数解析）`)
  // ══════════════════════════════════════════════════════════════
  const unguarded = []
  for (const ep of endpoints) {
    const r = await req(ep.method, ep.route, { body: ep.method === 'GET' ? undefined : {} })
    const cls = classify(r.status, true)
    if (cls !== 'guarded') unguarded.push({ ...ep, status: r.status, cls, snippet: r.text.slice(0, 120) })
  }
  check(`全部 ${endpoints.length} 个端点未登录时都拒绝（401/403）`,
    unguarded.length === 0,
    unguarded.length ? `${unguarded.length} 个未拒绝：` + unguarded.map(u => `${u.method} ${u.route}→${u.status}(${u.cls})`).join('  ') : '')
  // 逐个端点各记一条，便于出问题时定位到具体端点
  for (const ep of endpoints) {
    const bad = unguarded.find(u => u.route === ep.route && u.method === ep.method)
    check(`A·${ep.method} ${ep.route} 未登录→401/403`, !bad, bad ? `status=${bad.status}(${bad.cls}) ${bad.snippet}` : '')
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ B. 越权（IDOR）：普通用户动「别人的」资源 → 必须拒绝，且那行必须还在')
  // ══════════════════════════════════════════════════════════════
  {
    const idor = [
      ['DELETE', `/api/admin/bookmarks/${VICTIM_ROWS.bookmarkId}`, 'bookmarks', VICTIM_ROWS.bookmarkId],
      ['PUT', `/api/admin/bookmarks/${VICTIM_ROWS.bookmarkId}`, 'bookmarks', VICTIM_ROWS.bookmarkId],
      ['DELETE', `/api/admin/folders/${VICTIM_ROWS.folderId}`, 'folders', VICTIM_ROWS.folderId],
      ['PUT', `/api/admin/folders/${VICTIM_ROWS.folderId}`, 'folders', VICTIM_ROWS.folderId],
      ['DELETE', `/api/admin/prompts/${VICTIM_ROWS.promptId}`, 'prompts', VICTIM_ROWS.promptId],
      ['PUT', `/api/admin/prompts/${VICTIM_ROWS.promptId}`, 'prompts', VICTIM_ROWS.promptId],
      ['DELETE', `/api/admin/prompt-folders/${VICTIM_ROWS.promptFolderId}`, 'prompt_folders', VICTIM_ROWS.promptFolderId],
      ['PUT', `/api/admin/prompt-folders/${VICTIM_ROWS.promptFolderId}`, 'prompt_folders', VICTIM_ROWS.promptFolderId],
    ]
    for (const [m, p, table, id] of idor) {
      const r = await req(m, p, { cookie: cookieNormal, body: m === 'GET' ? undefined : { title: 'x', name: 'x', content: 'x' } })
      const rejected = r.status === 403 || r.status === 404
      check(`B·${m} ${p} 普通用户越权 → 403/404`, rejected, `status=${r.status} ${r.text.slice(0, 120)}`)
      check(`B·${m} ${p} 之后受害者的 ${table}#${id} 仍在（不能只看状态码）`,
        victimStillThere(table, id))
    }
    // 读别人的提示词版本历史
    const rv = await req('GET', `/api/admin/prompts/${VICTIM_ROWS.promptId}/versions`, { cookie: cookieNormal })
    check('B·GET 读取别人提示词的版本历史 → 403', rv.status === 403, `status=${rv.status}`)
    // 读别人的用户维度数据
    for (const p of [`/api/admin/users/${VICTIM_ROWS.userId}/bookmarks`, `/api/admin/users/${VICTIM_ROWS.userId}/prompts`]) {
      const r = await req('GET', p, { cookie: cookieNormal })
      check(`B·GET ${p} 普通用户读他人数据 → 403`, r.status === 403, `status=${r.status}`)
    }
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ C. 提权与破坏性操作：普通用户必须被拒，且库里不得发生变化')
  // ══════════════════════════════════════════════════════════════
  {
    // C1 把自己设成管理员
    const r1 = await req('PUT', `/api/admin/users/${VICTIM_ROWS.normalId}`, { cookie: cookieNormal, body: { is_admin: 1, username: U.normal } })
    check('C1 普通用户把自己设成管理员 → 被拒', r1.status === 403 || r1.status === 401, `status=${r1.status}`)
    const me = scalar('SELECT is_admin FROM users WHERE id = ?', VICTIM_ROWS.normalId)
    check('C1 之后自己的 is_admin 仍是 0（库里没变）', Number(me?.is_admin) === 0, `is_admin=${me?.is_admin}`)

    // C2 列出/删除用户
    const r2 = await req('GET', '/api/admin/users', { cookie: cookieNormal })
    check('C2 普通用户列出全部用户 → 403', r2.status === 403, `status=${r2.status}`)
    const r3 = await req('DELETE', `/api/admin/users/${VICTIM_ROWS.victimId}`, { cookie: cookieNormal })
    check('C3 普通用户删用户 → 被拒', r3.status === 403 || r3.status === 401, `status=${r3.status}`)
    check('C3 之后受害者用户仍在', !!scalar('SELECT 1 AS x FROM users WHERE id = ?', VICTIM_ROWS.userId))

    // C4 作者不能自审自过（文档明写的规则）：本人条目直接 published
    const r4 = await req('PUT', '/api/admin/token-deals/probe_own_deal/state',
      { cookie: cookieNormal, body: { state: 'published' } })
    check('C4 作者把自己的通告直接设为 published → 被拒（不能自审自过）',
      r4.status === 403 || r4.status === 400, `status=${r4.status} ${r4.text.slice(0, 120)}`)
    const d1 = scalar("SELECT state FROM token_deals WHERE id = 'probe_own_deal'")
    check('C4 之后自己的通告仍是 pending（库里没变）', d1?.state === 'pending', `state=${d1?.state}`)

    // C5 改别人的通告状态
    const r5 = await req('PUT', '/api/admin/token-deals/probe_victim_deal/state',
      { cookie: cookieNormal, body: { state: 'published' } })
    // 期望 404 而不是 403：handler 对「非作者且非管理员」故意回 404「通告不存在」，
    // 以免泄露该 id 是否存在（与本项目对通告的一贯口径一致，见 state.put.ts:41）。
    // 作者本人想自发布才是 403（state.put.ts:43-48，由 C4 覆盖）。
    check('C5 普通用户改他人通告状态 → 被拒（404 不泄露存在性）',
      r5.status === 404 || r5.status === 403, `status=${r5.status}`)
    const d2 = scalar("SELECT state FROM token_deals WHERE id = 'probe_victim_deal'")
    check('C5 之后他人通告仍是 pending', d2?.state === 'pending', `state=${d2?.state}`)

    // C6 破坏性 dev 端点
    const r6 = await req('POST', '/api/admin/dev/clear-prompts', { cookie: cookieNormal, body: {} })
    check('C6 普通用户调 dev/clear-prompts → 被拒', r6.status === 403 || r6.status === 401, `status=${r6.status}`)
    check('C6 之后受害者的提示词仍在（没被清掉）', victimStillThere('prompts', VICTIM_ROWS.promptId))

    const r7 = await req('POST', '/api/admin/manual-backup', { cookie: cookieNormal, body: {} })
    check('C7 普通用户触发手动备份 → 被拒', r7.status === 403 || r7.status === 401, `status=${r7.status}`)

    // C8 通告物理删除（purge）
    const r8 = await req('DELETE', '/api/admin/token-deals/probe_victim_deal/purge', { cookie: cookieNormal })
    check('C8 普通用户 purge 他人通告 → 被拒', r8.status === 403 || r8.status === 401, `status=${r8.status}`)
    check('C8 之后他人通告仍存在', !!scalar("SELECT 1 AS x FROM token_deals WHERE id = 'probe_victim_deal'"))
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ D. 管理员确实做得到（否则上面那些 403 可能只是功能坏了）')
  // ══════════════════════════════════════════════════════════════
  {
    const r = await req('PUT', '/api/admin/token-deals/probe_victim_deal/state',
      { cookie: cookieAdmin, body: { state: 'published' } })
    check('D1 管理员把通告设为 published → 成功', r.status >= 200 && r.status < 300, `status=${r.status} ${r.text.slice(0, 140)}`)
    const d = scalar("SELECT state FROM token_deals WHERE id = 'probe_victim_deal'")
    check('D1 之后库里 state=published', d?.state === 'published', `state=${d?.state}`)

    const r2 = await req('PUT', '/api/admin/token-deals/probe_victim_deal/state',
      { cookie: cookieAdmin, body: { state: 'offline' } })
    check('D2 管理员可设为 offline', r2.status >= 200 && r2.status < 300, `status=${r2.status}`)

    // 非法状态值必须 400（顺带钉住 SETTABLE_STATES 不含 deleted）
    const r3 = await req('PUT', '/api/admin/token-deals/probe_victim_deal/state',
      { cookie: cookieAdmin, body: { state: 'deleted' } })
    check('D3 deleted 不在可设状态里 → 400（软删除只能走专用端点）', r3.status === 400, `status=${r3.status}`)
  }
} catch (err) {
  console.error('\n套件异常：', err?.message || err)
  fails.push(`套件异常：${err?.message || err}`)
} finally {
  if (appProcess) { try { appProcess.kill('SIGTERM') } catch { /* ignore */ } }
  await sleep(400)
  for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    try { if (f && existsSync(f)) unlinkSync(f) } catch { /* ignore */ }
  }
  try { if (dbPath) rmSync(dbPath + '.backup', { force: true }) } catch { /* ignore */ }
}

console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
if (fails.length) {
  console.error('\n失败明细：')
  for (const f of fails) console.error('  ✗', f)
  process.exit(1)
}
