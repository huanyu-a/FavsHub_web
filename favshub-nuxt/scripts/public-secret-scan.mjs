#!/usr/bin/env node
/**
 * public-secret-scan.mjs — 「公开面不许漏密钥」契约
 *
 * ## 为什么要这个套件
 *
 * 226 个端点里，**唯一按设计会吐出 Key 明文的是 `/api/token-keys/:id/copy`**。
 * 除此之外任何一个端点（尤其是不需要登录的那些）万一开始回吐明文或密钥形态的值，
 * 就都是公开泄露 —— 而这件事此前只有 `key-copy-visibility` 从「copy 端点」那一侧看过，
 * 没人从「整个公开面」这一侧查过。
 *
 * 本套件种一条**真实形态**的明文 Key（`sk-` 开头、长度与线上一致）进临时库，然后：
 *
 *   - 把**所有** /api 端点以未登录身份打一遍，断言明文**只**出现在 copy 端点
 *   - 断言没有任何端点吐出匹配 `KEY_LIKE` 的值（遮蔽形态实测不匹配，不会误报）
 *   - 断言 `/api/settings` 里的密钥形态**值**被脱敏（这是 1.0.92 修的那处）
 *   - 断言脱敏**不误杀**：`theme` / `showPasswordsLink` 等正常设置原样返回
 *
 * ## 那个 `showPasswordsLink` 的坑（本套件存在的直接原因）
 *
 * `GET /api/settings` 会把系统设置（`user_id = 0`）发给**所有访客**。原先只有一张按**名字**
 * 的 `SENSITIVE_KEYS` 黑名单，而且它是空数组 —— 等于不设防。
 *
 * 「显然的修法」是「名字里含 password/secret/key 就过滤」。**这个修法是错的**：
 * 生产 settings 里真实存在 `showPasswordsLink`（扩展的「显示密码链接」开关），
 * 它会被 `password` 模式命中 —— 那样会误杀一个正经设置、破坏扩展同步。
 *
 * 所以改成**按值**脱敏（`scrubSecretValues`）：名字随便起，值的形态骗不了人；
 * 而 `showPasswordsLink` 的值是布尔，天然不会被误伤。下面第 5 组就是钉住这一点的回归测试。
 *
 * ## 三道防「假绿」护栏（都是被咬过之后加的）
 *
 *   1. **端口必须先空闲** —— 否则测到的是上一个残留实例、读的是**旧库**，
 *      于是「什么都没漏」地全绿。开发时真的这样被骗过一次。
 *   2. **种的数据必须可见** —— 证明被测应用读的就是我种的库。
 *   3. **前缀列表解析必须成功** —— 从真源 `utils/key-redact.ts` 抽出前缀，
 *      抽不到就当场失败，而不是拿一个空 alternation 去扫（那会永远扫不出东西）。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWithFreePort } from './lib/free-port.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// 独占端口 3269（3210-3277 里未被其他套件占用）
/**
 * 端口原先硬编码 3269：本机任何残留实例占住它，应用就 EADDRINUSE 直接死，
 * 而症状会被误读成「没扫出问题」的假绿。
 * 2026-11-09 改成运行时挑空闲端口 + 冲突换端口重试（见 scripts/lib/free-port.mjs）。
 */
let APP_PORT = 0
/** 由每次尝试开始时按**当次**端口重算 —— 重试会换端口，所以不能是常量 */
let BASE = ''
const ABSENT = '__probe_absent__'

/** 种进库里的「明文」。自己定义的字面量，形态与线上一致（`sk-` + 长串），但显然是假货。 */
const PLAINTEXT = 'sk-canaryLEAK0000111122223333'
/** 种进系统设置里的另一个密钥形态的值，用另一条前缀分支（`gsk_`），顺带覆盖 alternation 的另一半 */
const SETTINGS_SECRET = 'gsk_canarySETTINGS44445555'
const DEAL_ID = 'probe_secret_deal'
const KEY_ID = 'probe_secret_key'

let pass = 0
const fails = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.error('  ✗', name, detail) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let dbPath = ''
let appProcess = null
const req = () => createRequire(join(ROOT, 'package.json'))

// ── 从真源抽前缀，构造与产品一致的 KEY_LIKE ──
const redactSrc = readFileSync(join(ROOT, 'utils', 'key-redact.ts'), 'utf8')
function extractArray(name) {
  const m = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(redactSrc)
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
}
const KEY_PREFIXES = extractArray('KEY_PREFIXES')
const KEY_PREFIX_SPECIFIC = extractArray('KEY_PREFIX_SPECIFIC')
// 抽不到前缀就当场失败：拿空 alternation 去扫会永远扫不出东西（静默失效比报错危险得多）
check('护栏3 从真源抽到 KEY_PREFIXES（≥10 条）',
  Array.isArray(KEY_PREFIXES) && KEY_PREFIXES.length >= 10,
  `抽到 ${KEY_PREFIXES ? KEY_PREFIXES.length : 'null'} 条`)
check('护栏3 从真源抽到 KEY_PREFIX_SPECIFIC', Array.isArray(KEY_PREFIX_SPECIFIC) && KEY_PREFIX_SPECIFIC.length >= 1)
const KEY_LIKE = new RegExp(
  `\\b[A-Za-z0-9_-]*(?:${(KEY_PREFIX_SPECIFIC || []).join('|')}|${(KEY_PREFIXES || []).join('|')})[A-Za-z0-9_-]{8,}`)

/** 遮蔽形态必须**不**匹配 KEY_LIKE —— 否则「按值扫」会有大量误报，本套件的思路就不成立 */
check('护栏3 前提前提：遮蔽形态不匹配 KEY_LIKE（否则按值扫不可用）',
  !KEY_LIKE.test('sk-probe…wxyz'), '遮蔽值 sk-probe…wxyz 竟然匹配了 KEY_LIKE')

function enumerateApiEndpoints() {
  const root = join(ROOT, 'server', 'api')
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      const m = /^(.*)\.(get|post|put|patch|delete)\.ts$/.exec(name)
      if (!m) continue
      let route = '/api/' + relative(root, p).split(sep).join('/')
        .replace(/\.(get|post|put|patch|delete)\.ts$/, '')
      route = route.replace(/\/index$/, '')
        .replace(/\/\[\.\.\.[^\]]+\]/g, '/' + ABSENT)
        .replace(/\/\[[^\]]+\]/g, '/' + ABSENT)
      out.push({ method: m[2].toUpperCase(), route })
    }
  }
  walk(root)
  return out.sort((a, b) => (a.route + a.method).localeCompare(b.route + b.method))
}

async function probe(method, path) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 6000)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: method === 'GET' ? undefined : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
      redirect: 'manual',
      signal: ac.signal,
    })
    return { status: res.status, text: await res.text() }
  } catch (e) {
    return { status: 0, text: 'TIMEOUT:' + (e?.name || 'unknown') }
  } finally { clearTimeout(timer) }
}

/**
 * 起一次应用（端口由 `startWithFreePort` 传入）。
 * 护栏1（端口空闲探测）/ 就绪探测 / 30s 超时 / 限流放宽环境变量 / 日志捕获与原实现一致，
 * 另有三处**必要**改动（让「换端口重试」真的能触发）：
 *   ① 护栏1 撞上占用时**抛「端口被占」**而不是 `process.exit(1)` —— 端口是刚由内核分配的，
 *      撞上说明它在「释放 → 我们 listen」的窗口里被别人抢走，该换端口重试，不该让整套件死掉；
 *   ② 子进程 stderr 另存一份并带进抛出的错误（EADDRINUSE 只在 stderr 里）；子进程已退出立刻抛错；
 *   ③ 探测加 3s 超时：对端「接而不答」时原来的 fetch 会永挂，连 30s 上限都到不了。
 */
async function startOnce(port) {
  APP_PORT = port
  BASE = `http://127.0.0.1:${port}`
  console.log(`  · 试用端口 ${port}`)
  // 护栏1：端口必须先空闲（若被占，下面测的是**旧库**，会「什么都没漏」地假绿）
  let busy = false
  try { const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) }); busy = r.ok } catch { /* 空闲，正常 */ }
  if (busy) throw new Error(`端口 ${port} 仍被占用（EADDRINUSE：残留实例，或选到的端口在 listen 前被抢走）`)
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 pnpm build'); process.exit(1) }
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      NUXT_DB_PATH: dbPath,
      // 一次扫 224 个端点会撞上站点写层限流（默认 120/分钟），429 会污染结论
      FAVSHUB_RL_SITE_READ_PER_MIN: '100000',
      FAVSHUB_RL_SITE_WRITE_PER_MIN: '100000',
      FAVSHUB_RL_SITE_ASSET_PER_MIN: '100000',
      FAVSHUB_RL_SITE_CONCURRENCY: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  const appLogs = []
  appProcess.stderr.on('data', (d) => { const s = String(d); appLogs.push(s); console.error(`  [app] ${s.trim().slice(0, 200)}`) })
  let earlyExit = null
  appProcess.on('exit', (code, signal) => { earlyExit = { code, signal } })
  {
    const start = Date.now()
    let up = false
    while (Date.now() - start < 30_000) {
      if (earlyExit) throw new Error(`应用启动即退出（code=${earlyExit.code} signal=${earlyExit.signal}）：\n${appLogs.join('').slice(-800)}`)
      try { const r = await fetch(`${BASE}/api/announcements`, { signal: AbortSignal.timeout(3000) }); if (r.ok) { up = true; break } } catch { /* 等 */ }
      await sleep(500)
    }
    if (!up) throw new Error(`应用 30s 内未就绪：\n${appLogs.join('').slice(-800)}`)
  }
}
/** 失败重试前收掉这一次的子进程（原 finally 的清理逻辑不变，这里只是让重试路径也能复用） */
async function stopApp() {
  if (!appProcess) return
  const proc = appProcess
  appProcess = null
  try { proc.kill('SIGTERM') } catch { /* ignore */ }
  await sleep(300)
  if (!proc.killed) { try { proc.kill('SIGKILL') } catch { /* ignore */ } }
}
/**
 * 对外入口：挑空闲端口 → 起应用；**只有证据是「端口被占」时才换端口重试**
 * （其它错误立刻抛，不空转 attempts 次）。
 */
async function startApp() {
  const up = await startWithFreePort(async (port) => {
    try {
      return await startOnce(port)
    } catch (e) {
      await stopApp()
      throw e
    }
  }, {
    attempts: 5,
    onRetry: ({ attempt, port, nextPort, error }) => {
      console.error(`  ↻ 第 ${attempt} 次起应用失败（端口 ${port} 被占），换端口重试 → ${nextPort}`)
      console.error(`     ${String(error?.message || error).split('\n')[0].slice(0, 160)}`)
    },
  })
  // 护栏1 的断言。原实现里它写死在启动**前**、判据是字面 `true` —— 那是**恒真断言**，
  // 等于没测（撞上占用时直接 process.exit(1)，根本走不到它）。现在端口先由内核分配、
  // 再在 startOnce 里探测是否被占，撞上就换端口重试，于是这条断言挪到「起成功之后」，
  // 并改成**真的能被证伪**的判据（与 lead 在 deal-subscriptions.mjs / ai-api-gate.mjs 的同款改法）：
  // 答话的必须是我们自己起的进程。
  //
  // 依据：同一时刻一个端口只能被一个进程绑定。若那个端口上是残留实例，我们的子进程
  // 会在 listen 时 EADDRINUSE 立刻退出（startOnce 的 early-exit 检测会先抛错）；
  // 反过来，子进程活着 + 接口可答 ⇒ 答话的就是它，不是别人的旧库。
  check('护栏1 起到的实例是我们自己的进程（避免测到残留实例的旧库）',
    !!appProcess && appProcess.exitCode === null && appProcess.signalCode === null,
    `pid=${appProcess?.pid} exitCode=${appProcess?.exitCode} signal=${appProcess?.signalCode}`)
  return up
}

try {
  mkdirSync(join(ROOT, 'data'), { recursive: true })
  dbPath = join(ROOT, 'data', `public-secret-${Date.now()}.db`)

  // ── 护栏1（端口必须先空闲）+ 起应用 ──
  // 逻辑搬进了 startApp/startOnce：占用时不再 process.exit(1)，而是换端口重试。
  await startApp()

  // ── 等迁移建表（迁移是异步的，等接口返回不够）──
  {
    const Database = req()('better-sqlite3')
    let ready = false
    for (let i = 0; i < 60; i++) {
      try {
        const db = new Database(dbPath, { readonly: true })
        const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()
        db.close()
        if (t) { ready = true; break }
      } catch { /* 还没建 */ }
      await sleep(500)
    }
    if (!ready) throw new Error('30s 内未见 users 表，迁移可能失败')
  }

  // ── 种数据 ──
  {
    const Database = req()('better-sqlite3')
    const db = new Database(dbPath)
    const now = Date.now()
    const nowSec = Math.floor(now / 1000)
    try {
      const uid = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get()?.id ?? 1
      db.prepare(`INSERT INTO token_deals
        (id,user_id,provider,title,url,category,state,status,created_at,source_tag,quality)
        VALUES (?,?,?,?,?,?,?,?,?,'community','中品')`)
        .run(DEAL_ID, uid, 'probe-provider', '探针·密钥扫描', 'https://scan.example.com/', 'token', 'published', 'published', now)

      // 明文 Key：形态与线上一致（sk- 开头），并带上真实的公开字段
      db.prepare(`INSERT INTO token_keys
        (id,source_id,source_url,source_title,key_masked,key_hash,key_plain,base_url,provider,source,
         confidence,verdict,deal_status,note,created_at,updated_at,first_seen_at,last_probe_at,copy_count)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(KEY_ID, 'linux_sb', 'https://forum.example.com/t/1', '探针原帖', 'sk-canary…3333',
          'probehash', PLAINTEXT, 'https://api.example.com/v1', 'probe-provider', 'post',
          'high', 'alive', 'published', '', now, now, nowSec, nowSec, 0)

      // 系统设置：一个密钥形态的值 + 几个必须原样返回的正常设置
      db.prepare('INSERT OR REPLACE INTO settings (user_id, data) VALUES (0, ?)').run(JSON.stringify({
        theme: 'light',
        showPasswordsLink: true,          // ← 名字黑名单会误杀它，必须原样返回
        welcomeMessage: '欢迎',
        customSearchEngines: [            // ← 嵌套结构，验证递归脱敏
          { name: 'ok', url: 'https://ok.example.com/' },
          { name: 'nested', url: `https://x.example.com/?k=${SETTINGS_SECRET}` },
        ],
        upstreamApiKey: SETTINGS_SECRET,  // ← 必须被脱敏
      }))
    } finally { db.close() }
  }

  // ── 护栏2：证明被测应用读的就是这个库 ──
  {
    const r = await probe('GET', `/api/token-deals/${DEAL_ID}`)
    const visible = r.status === 200 && r.text.includes('探针·密钥扫描')
    check('护栏2 种入的通告对匿名可见（证明应用读的是这个库）', visible, `status=${r.status}`)
    if (!visible) throw new Error('被测应用看不到刚种的数据，后续结论无意义')
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第1组：明文只允许出现在 copy 端点')
  // ══════════════════════════════════════════════════════════════
  const endpoints = enumerateApiEndpoints()
  const results = []
  for (const ep of endpoints) {
    const r = await probe(ep.method, ep.route)
    // 明文是否出现（注意这里看的是**明文本身**，不是形态）
    if (r.text.includes(PLAINTEXT)) results.push({ method: ep.method, route: ep.route, status: r.status })
  }
  const extras = [
    { method: 'GET', route: `/api/token-keys/${KEY_ID}/copy`, label: 'copy（唯一合法出口）' },
    { method: 'GET', route: `/api/token-keys/${KEY_ID}`, label: 'key 详情' },
    { method: 'GET', route: `/api/token-deals/${DEAL_ID}`, label: '通告详情' },
  ]
  for (const e of extras) {
    const r = await probe(e.method, e.route)
    if (r.text.includes(PLAINTEXT)) results.push({ method: e.method, route: e.route, status: r.status })
  }

  const copyRoute = `/api/token-keys/${KEY_ID}/copy`
  check('对照·copy 端点确实吐明文（证明种入的明文是可被取到的，不是种错了）',
    results.some(r => r.route === copyRoute), `命中端点: ${results.map(r => r.route).join(', ') || '无'}`)

  const otherLeaks = results.filter(r => r.route !== copyRoute)
  check('除 copy 外没有任何未登录可达端点回吐明文',
    otherLeaks.length === 0, otherLeaks.map(r => `${r.method} ${r.route}(${r.status})`).join(', '))
  for (const e of ['/api/token-keys', '/api/token-deals', '/api/settings', '/api/token-keys/my-votes']) {
    const r = await probe('GET', e)
    check(`${e} 明文中不含明文`, !r.text.includes(PLAINTEXT), r.text.slice(0, 120))
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第2组：没有任何端点吐出「密钥形态」的值')
  // ══════════════════════════════════════════════════════════════
  {
    const hits = []
    for (const ep of endpoints) {
      const r = await probe(ep.method, ep.route)
      const m = KEY_LIKE.exec(r.text)
      if (m) hits.push(`${ep.method} ${ep.route} → ${m[0].slice(0, 24)}…`)
    }
    check('全部 224 个端点（含未登录可达的）都没有密钥形态的值',
      hits.length === 0, hits.slice(0, 6).join(' | '))
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第3组：/api/settings 的密钥形态值被脱敏')
  // ══════════════════════════════════════════════════════════════
  {
    const r = await probe('GET', '/api/settings')
    check('/api/settings 匿名可取 → 200', r.status === 200, `status=${r.status}`)
    check('顶层密钥形态的值已脱敏（不含 gsk_ 明文）', !r.text.includes(SETTINGS_SECRET), r.text.slice(0, 200))
    check('嵌套数组里的密钥形态值也已脱敏（验证递归）',
      !r.text.includes(SETTINGS_SECRET) && r.text.includes('nested'), r.text.slice(0, 300))
    check('脱敏后键仍在（保留结构，避免前端因字段消失报错）',
      r.text.includes('upstreamApiKey'), r.text.slice(0, 200))
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第4组：脱敏不得误杀正常设置（防止「靠弄坏功能通过测试」）')
  // ══════════════════════════════════════════════════════════════
  {
    const r = await probe('GET', '/api/settings')
    let data = {}
    try { data = JSON.parse(r.text).data || {} } catch { /* 下面断言会报 */ }
    check('theme 原样返回（值未被动过）', data.theme === 'light', `theme=${JSON.stringify(data.theme)}`)
    check('welcomeMessage 原样返回', data.welcomeMessage === '欢迎', `=${JSON.stringify(data.welcomeMessage)}`)
    // 这一条直接钉住「名字黑名单」这个错误修法：showPasswordsLink 必须活着
    check('showPasswordsLink 原样返回（名字含 password，但它是布尔开关，不得被按名字过滤）',
      data.showPasswordsLink === true, `=${JSON.stringify(data.showPasswordsLink)}`)
    check('customSearchEngines 里正常的 url 原样保留',
      JSON.stringify(data.customSearchEngines || []).includes('https://ok.example.com/'),
      JSON.stringify(data.customSearchEngines).slice(0, 160))
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第5组：明文出口没有被「一并关掉」')
  // ══════════════════════════════════════════════════════════════
  {
    const r = await probe('GET', `/api/token-keys/${KEY_ID}/copy`)
    check('copy 端点仍可用 → 200（证明是「只堵泄露」而不是「把功能关了」）',
      r.status === 200, `status=${r.status}`)
    check('copy 端点仍下发完整明文', r.text.includes(PLAINTEXT), r.text.slice(0, 120))
    check('copy 端点仍下发完整 base_url', r.text.includes('https://api.example.com/v1'), r.text.slice(0, 160))
  }
} catch (err) {
  console.error('\n套件异常：', err?.message || err)
  fails.push(`套件异常：${err?.message || err}`)
} finally {
  if (appProcess) { try { appProcess.kill('SIGTERM') } catch { /* ignore */ } }
  await sleep(500)
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (dbPath) rmSync(dbPath + suffix, { force: true }) } catch { /* ignore */ }
  }
}

console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
if (fails.length) {
  console.error('\n失败明细：')
  for (const f of fails) console.error('  ✗', f)
  process.exit(1)
}
