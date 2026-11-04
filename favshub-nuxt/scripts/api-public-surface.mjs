#!/usr/bin/env node
/**
 * api-public-surface.mjs — 整个 /api 的「公开面」契约（未登录可达的端点，逐个打）
 *
 * ## 为什么要这个套件
 *
 * 226 个 /api 端点里，**哪些不需要登录就能访问，此前没有任何东西记录**。
 * 而这是最容易悄悄出错的地方：把 `requireAuth` 写成 `optionalAuth`、新端点忘了加鉴权、
 * 或者某个端点从「顺手返回点公开数据」变成「顺带返回全部数据」—— 都不会有任何提示。
 *
 * 本套件把「公开面」变成一张**逐个读过源码**的白名单：226 个端点全部以未登录身份打一遍，
 * 2xx 的必须**恰好**是白名单里的那些。多一个 → 报红（新暴露）；少一个 → 报红（公开功能被误锁）。
 *
 * ## 六个防「假绿」对照
 *
 * 这类「扫一遍看状态码」的套件最容易自欺（路径写错→全 404→全绿）。所以：
 *   1. 已知公开端点（/api/announcements）必须被判为 public —— 证明探针看得见 2xx
 *   2. 已知受保护端点（/api/admin/users）必须**不** public —— 证明探针不会把什么都当公开
 *   3. 同一个端点带 cookie 时必须变成 200（/api/admin/bookmarks）—— 证明「未登录」是真的未登录
 *   4. 白名单里每一项都必须真的出现在实测公开集合里（防我把已收紧的端点漏留在名单里）
 *   5. 不得出现 429 —— 否则是限流干扰，会让「非 2xx」变成假象
 *   6. 不得出现 5xx —— 未登录就能把服务端打挂是更严重的问题
 *
 * ## 参数化路由的说明（别把这张表读错）
 *
 * `[id]` / `[...slug]` 这类路由用**不存在的 id** 探测，所以它们即使在设计上是公开的
 * （比如通告详情页），也会表现为 404 而不在公开集合里。为此第 7 组用**真实存在**的
 * 已发布通告验证「参数化公开路由确实公开」，再用一条 pending 通告验证「未发布的确实 404」。
 *
 * 用法：node scripts/api-public-surface.mjs
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// 独占端口 3267（与其他套件错开 —— 3261 已被 third-batch-detail 占用）
const APP_PORT = 3267
const BASE = `http://127.0.0.1:${APP_PORT}`
const ABSENT = '__probe_absent__'
// 探针账号的密码：**自己定义的字面量**，本文件不读任何外部密钥 ——
// 之前写成 {{...}} 形式会被替换成一个不透明的值，读代码的人无从判断它是什么，
// 也把「测试」和「密钥」这两件不相干的事绑在了一起。
const PW_PROBE = 'ProbePublicSurface123'

let pass = 0
const fails = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.error('  ✗', name, detail) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let dbPath = ''
let appProcess = null
const requireFromRoot = () => createRequire(join(ROOT, 'package.json'))

/**
 * 公开面白名单 —— 每一项都读过源码，理由写在后面。
 * 26 项，与实测一致；任何增删都必须同步改这里（套件会强制你面对它）。
 */
const PUBLIC_ALLOWED = new Map([
  // ── 站点内容展示（导航站的本来用途）──
  ['GET /api/announcements', '站点公告 —— 站内通知，本就要给所有人看'],
  ['GET /api/collections', '精选集列表 —— 公开订阅入口'],
  ['GET /api/friend-links', '友情链接 —— 公开页脚'],
  ['GET /api/health', '健康检查 —— 且在限流 exemptPrefixes 里'],
  ['GET /api/search-engines', '搜索引擎列表 —— 导航站核心数据，公开'],
  ['GET /api/settings', '系统设置（user_id=0）—— 游客分支只回系统设置；⚠️ 见文件末「已知潜伏项」'],
  ['GET /api/config/registration', '注册开关 —— 前端据此决定是否显示注册入口'],

  // ── 书签/文件夹/提示词/标签的「公开部分」──
  // 三个 handler 的文件头都写明：游客只看管理员的公开项（login_required=0，含继承）
  ['GET /api/bookmarks', '游客：管理员的公开书签（login_required=0 + 继承过滤）'],
  ['GET /api/folders', '游客：管理员的公开文件夹（同上）'],
  ['GET /api/prompts', '游客：`p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)`'],
  ['GET /api/prompts/folders/all', '游客：管理员的公开提示词文件夹'],
  ['GET /api/prompts/tag-relations', '公开提示词的标签关系（供前端按标签筛选）'],
  ['GET /api/tags', '游客：公开提示词的标签'],

  // ── 白嫖通告（对外分发是本项目的主线）──
  ['GET /api/token-deals', '通告列表 —— 公开，且白名单状态已由 state 模型过滤（仅 published）'],
  ['GET /api/token-deals/changes', '变更事件流 —— 供 AI 技能包/订阅方轮询'],
  ['GET /api/token-deals/feed.atom', 'Atom feed —— 对外分发'],
  ['GET /api/token-deals/feed.json', 'JSON Feed —— 对外分发'],
  ['GET /api/token-deals/guest-challenge', '人机校验开关 —— 游客提交前的探测，必须公开'],

  // ── 福利 Key（游客只能看到引导型条目，明文走 /copy）──
  ['GET /api/token-keys', 'Key 列表 —— `deal_status=published AND verdict!=dead`，列表本身不含明文'],
  ['GET /api/token-keys/my-votes', '「我的投票」——游客身份为空集，不含他人数据'],

  // ── SEO / 元信息 ──
  ['GET /api/tdk', 'TDK 元信息 —— 给爬虫和分享卡片用'],
  ['GET /api/tdk/collections', '精选集页 TDK'],
  ['GET /api/tdk/promptpro', 'PromptPro 页 TDK'],

  // ── 认证流程自身的公开端点 ──
  ['POST /api/auth/logout', '登出 —— 未登录也能调，返回 success，无副作用'],
  ['GET /api/auth/register-challenge', '注册人机校验开关 —— 注册流程第一步，必须公开'],

  // ── 游客可用的写入口（受各自的人机校验/限流保护）──
  ['POST /api/deal-subscriptions', '订阅通告变更 —— 游客可用，返回 sub_token 作为能力凭证，受限流保护'],
])

// ── 枚举 /api/** 端点（从文件系统读，代码增删自动跟上）──
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
      out.push({ method: m[2].toUpperCase(), route, file: relative(ROOT, p) })
    }
  }
  walk(root)
  out.sort((a, b) => (a.route + a.method).localeCompare(b.route + b.method))
  return out
}

function ensureNativeModule() {
  const req = requireFromRoot()
  const load = () => { try { req('better-sqlite3'); return true } catch { return false } }
  if (!load()) {
    const { spawnSync } = requireFromRoot()('node:child_process')
    spawnSync('pnpm', ['rebuild', 'better-sqlite3'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (!load()) throw new Error('better-sqlite3 无法加载')
  }
}

async function startApp() {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 pnpm build'); process.exit(1) }
  ensureNativeModule()
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(APP_PORT),
      NUXT_DB_PATH: dbPath,
      // 本套件要测的是**鉴权**行为，而一次扫 224 个端点会撞上站点自己的写层限流
      // （默认 120 次/分钟）—— 那样「非 2xx」里会混进 429，可能**掩盖一个真正公开的端点**。
      // 这里把三档阈值抬到实际无效的高度，让结论只反映鉴权。
      // 下面的 429 断言仍然保留：万一这个覆盖失效了，套件会明确报「限流干扰」而不是悄悄给出错结论。
      FAVSHUB_RL_SITE_READ_PER_MIN: '100000',
      FAVSHUB_RL_SITE_WRITE_PER_MIN: '100000',
      FAVSHUB_RL_SITE_ASSET_PER_MIN: '100000',
      FAVSHUB_RL_SITE_CONCURRENCY: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => console.error(`  [app] ${String(d).trim().slice(0, 200)}`))
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    try { const r = await fetch(`${BASE}/api/announcements`); if (r.ok) return } catch { /* 等就绪 */ }
    await sleep(500)
  }
  throw new Error('应用 30s 内未就绪')
}

/** 未登录探测；带 6s 超时以免被出站调用类端点拖死 */
async function probe(method, path, cookie = '') {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 6000)
  try {
    const headers = {}
    if (cookie) headers.cookie = cookie
    if (method !== 'GET') headers['content-type'] = 'application/json'
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : '{}',
      redirect: 'manual',
      signal: ac.signal,
    })
    const text = await res.text()
    return { status: res.status, text }
  } catch (e) {
    return { status: 0, text: 'TIMEOUT:' + (e?.name || e?.message || 'unknown') }
  } finally { clearTimeout(timer) }
}

try {
  mkdirSync(join(ROOT, 'data'), { recursive: true })
  dbPath = join(ROOT, 'data', `api-public-${Date.now()}.db`)
  const endpoints = enumerateApiEndpoints()
  console.log(`▶ 启动应用（PORT=${APP_PORT}）｜枚举到 ${endpoints.length} 个 /api 端点`)
  await startApp()

  // 种一条已发布通告 + 一条待审通告，用于第 7 组（参数化路由）
  const DEAL_PUB = 'probe_public_deal'
  const DEAL_PENDING = 'probe_hidden_deal'
  {
    const Database = requireFromRoot()('better-sqlite3')
    const db = new Database(dbPath)
    const now = Date.now()
    try {
      const admin = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get()
      const uid = admin?.id ?? 1
      const ins = db.prepare(
        `INSERT INTO token_deals (id, user_id, provider, title, url, category, state, status,
          created_at, source_tag, quality)
         VALUES (?,?,?,?,?,?,?,?,?, 'community', '中品')`,
      )
      ins.run(DEAL_PUB, uid, 'probe-provider', '探针·已发布通告', 'https://pub.example.com/', 'token', 'published', 'published', now)
      ins.run(DEAL_PENDING, uid, 'probe-provider', '探针·待审通告', 'https://pend.example.com/', 'token', 'pending', 'pending', now)
    } finally { db.close() }
  }

  // 造一个登录 cookie（第 3 组对照用）
  const cookieMine = await (async () => {
    const Database = requireFromRoot()('better-sqlite3')
    const bcrypt = requireFromRoot()('bcryptjs')
    const db = new Database(dbPath)
    try {
      db.prepare('INSERT INTO users (username,email,password_hash,is_admin,created_at) VALUES (?,?,?,?,?)')
        .run('probe_pub_u', 'probe_pub_u@probe.test', bcrypt.hashSync(PW_PROBE, 4), 0, Date.now())
    } finally { db.close() }
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'probe_pub_u', password: PW_PROBE }),
    })
    return (res.headers.getSetCookie?.() || []).find(c => c.startsWith('favshub_token='))?.split(';')[0] || ''
  })()

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 防假绿 · 对照 1~3：探针本身必须先被证明可信')
  // ══════════════════════════════════════════════════════════════
  {
    const pub = await probe('GET', '/api/announcements')
    check('对照1 探针能看见公开端点的 2xx（/api/announcements）',
      pub.status >= 200 && pub.status < 300, `status=${pub.status}`)
    const prot = await probe('GET', '/api/admin/users')
    check('对照2 探针不会把受保护端点当成公开（/api/admin/users）',
      !(prot.status >= 200 && prot.status < 300), `status=${prot.status}`)
    const anon = await probe('GET', '/api/admin/bookmarks')
    const auth = await probe('GET', '/api/admin/bookmarks', cookieMine)
    check('对照3 「未登录」是真的未登录：同一端点带 cookie 后由拒绝变 200',
      !(anon.status >= 200 && anon.status < 300) && auth.status >= 200 && auth.status < 300,
      `匿名=${anon.status} 带cookie=${auth.status}（cookie ${cookieMine ? '已取得' : '❌未取得'}）`)
  }

  // ══════════════════════════════════════════════════════════════
  console.log(`\n▶ 未登录扫全部 ${endpoints.length} 个端点`)
  // ══════════════════════════════════════════════════════════════
  const results = []
  for (const ep of endpoints) {
    const r = await probe(ep.method, ep.route)
    results.push({ ...ep, status: r.status, text: r.text })
  }

  const isPublic = (r) => r.status >= 200 && r.status < 300
  const publicSet = results.filter(isPublic).map(r => `${r.method} ${r.route}`).sort()
  const expected = [...PUBLIC_ALLOWED.keys()].sort()

  // 4. 白名单每一项都必须真的公开
  for (const key of expected) {
    check(`白名单 ${key} 确实可匿名访问`, publicSet.includes(key),
      `实测状态=${results.find(r => `${r.method} ${r.route}` === key)?.status ?? '未找到该端点'}`)
  }
  // 5. 每一个实测公开的端点都必须在白名单里（逐条报，便于定位）
  for (const key of publicSet) {
    check(`实测公开的 ${key} 在白名单内（有源码依据）`, PUBLIC_ALLOWED.has(key),
      PUBLIC_ALLOWED.has(key) ? '' : '这是**新暴露**的端点，必须读过源码后显式加入白名单')
  }
  // 6. 集合精确相等
  check(`公开集合与白名单精确相等（各 ${expected.length} 个）`,
    expected.length === publicSet.length && expected.every((k, i) => k === publicSet[i]),
    `多出: ${publicSet.filter(k => !PUBLIC_ALLOWED.has(k)).join(', ') || '无'}；缺失: ${expected.filter(k => !publicSet.includes(k)).join(', ') || '无'}`)

  // 7. 429 / 5xx：会污染判断，必须单独报
  const throttled = results.filter(r => r.status === 429)
  // 正常情况下上面已把站点限流抬到无效高度，不该出现 429。
  // 一旦出现，多半是 FAVSHUB_RL_SITE_* 覆盖失效，或是某个端点**自带的**限流 ——
  // 无论哪种，「非 2xx」都不再可信，必须查明后再看结论。
  check('未出现 429（否则「非 2xx」可能是限流假象，结论不可信）', throttled.length === 0,
    throttled.map(r => `${r.method} ${r.route}`).slice(0, 6).join(', '))
  const serverErr = results.filter(r => r.status >= 500)
  check('未出现 5xx（未登录不该能把服务端打挂）', serverErr.length === 0,
    serverErr.map(r => `${r.method} ${r.route}→${r.status}`).slice(0, 6).join(', '))
  const timedOut = results.filter(r => r.status === 0)
  check('未出现超时（否则结论不完整）', timedOut.length === 0,
    timedOut.map(r => `${r.method} ${r.route}`).slice(0, 6).join(', '))

  // 全部端点逐条留痕（哪一类都行，只要不是 2xx 就算「非公开」）
  for (const r of results) {
    if (isPublic(r)) continue
    check(`非公开 ${r.method} ${r.route} → ${r.status}`, true)
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 参数化路由：用真实存在的通告验证「公开的确实公开、未发布的确实看不见」')
  // ══════════════════════════════════════════════════════════════
  {
    const ok = await probe('GET', `/api/token-deals/${DEAL_PUB}`)
    check('匿名可取已发布通告详情 → 200', ok.status === 200, `status=${ok.status} ${ok.text.slice(0, 120)}`)
    check('已发布通告详情里出现其标题（证明拿到的确实那条）',
      ok.text.includes('探针·已发布通告'), ok.text.slice(0, 120))
    const hidden = await probe('GET', `/api/token-deals/${DEAL_PENDING}`)
    check('匿名取待审通告详情 → 404（未发布不可见，不是 403）',
      hidden.status === 404, `status=${hidden.status} ${hidden.text.slice(0, 120)}`)
    const absent = await probe('GET', `/api/token-deals/${ABSENT}`)
    check('匿名取不存在的通告 → 404', absent.status === 404, `status=${absent.status}`)
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
}

// ── 已知潜伏项（本轮查证：生产无实际暴露，但是设计上的隐患）────────────────
//
// `GET /api/settings` 的游客分支本意是「返回系统设置并**过滤敏感字段**」，实现里也确实
// 遍历 `SENSITIVE_KEYS` 做过滤 —— 但那张表**是空数组**，等于什么都没滤。
// 也就是说：任何写进 `settings` 表 `user_id = 0` 的键值，都会原样发给匿名访客。
//
// 2026-11-05 查证结论：**当前无实际暴露** —— 生产库里 `user_id = 0` 那行是 `{}`（长度 2），
// 匿名 `GET /api/settings` 返回空对象。所以这是「潜伏」而不是「泄露」，
// 与 1.0.86 那次（读侧脱敏名单比写侧窄、生产 0 命中）属同一类。
//
// 但一旦有人在系统设置里存了密钥/token/内部地址，就会**立刻**变成公开泄露，
// 而且不会有任何东西提醒你。这里不去改它（改 `SENSITIVE_KEYS` 的内容属于产品决策：
// 哪些键算敏感，取决于将来实际往 settings 里放什么），只把它记在这里和 DEPLOYMENT-STATE。
//
// 复现：匿名 GET /api/settings，看响应里有没有你不想公开的键。

console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
if (fails.length) {
  console.error('\n失败明细：')
  for (const f of fails) console.error('  ✗', f)
  process.exit(1)
}
