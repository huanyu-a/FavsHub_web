#!/usr/bin/env node
/**
 * admin-invalid-filters.mjs — 后台「已失效」面板**筛选功能**的端到端契约
 *
 * 背景：2026-11-09 给 `/admin/token-deals?tab=invalid` 加了筛选条（分类 / 品质 / 地区 /
 * 来源 / 发布者 / 失效原因 / 关键词 + 三档 chip 计数）。这条链路的坑在于
 * **chip 数字与列表口径必须一致** —— 出现「chip 说 15、点进去只有 2 条」时，
 * 管理员无从判断到底哪边错了。
 *
 * 验证思路（关键）：期望值**不来自后端**。先从 API 取一次无筛选的全量面板行，
 * 在**客户端按字段自己重新分类/筛选**，再与后端带参筛选的结果逐条比对。
 * 另用 better-sqlite3 直读临时库同谓词复算，交叉核对总数。
 * 若期望值也来自后端，那只是「用实现验证实现」，筛选写错时两边一起错、测试照样绿。
 *
 * 本套件**自建数据**：不依赖任何本机 dev 库（此前只活在 /tmp 的版本依赖
 * `data/favshub.db` 的副本，CI 里跑不了，等于没有回归保护）。
 * 启动流程照 `state-machine.mjs`：临时库 + `.output` 生产构建 + `NUXT_ADMIN_USERS` 旁路管理员。
 *
 * 用法：node scripts/admin-invalid-filters.mjs      （退出码 0 = 契约成立）
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 端口运行时选空闲端口（与 state-machine.mjs 同日同因）。
 * 硬编码端口在「本机有残留实例」时会失败，且失败会伪装成「断言数回归」。
 */
async function pickFreePort() {
  const { createServer } = await import('node:net')
  return await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

const PORT = await pickFreePort()
const BASE = `http://127.0.0.1:${PORT}`
const WORK = mkdtempSync(join(tmpdir(), 'favshub-invfilter-'))
const DB = join(WORK, 'invfilter.db')
const ADMIN_USER = 'invfilter_admin'
const PASSWORD = '{{SECRET_w1nf1ltr}}'

let pass = 0, fail = 0
const failures = []
const ok = m => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m, d) => { fail++; failures.push(m + (d ? ` — ${d}` : '')); console.error(`  ✗ ${m}${d ? ' — ' + d : ''}`) }
const check = (m, c, d) => c ? ok(m) : bad(m, d)

// ── 安全读取助手 ──
// 接口若返回 500 / 非 JSON，`r.json` 就是 null。直接写 `TOT(r)` 会让整个
// 套件抛 TypeError 中断，而摘要仍打印「N 通过 / 0 失败」—— 报错信息与实际结果相反。
// 这些助手把「读不到」变成 undefined，于是断言如实报红并列出可读的失败项。
const TOT = r => r?.json?.pagination?.total
const PAGES = r => r?.json?.pagination?.totalPages
const DEALS = r => r?.json?.deals || []
const LC = r => r?.json?.lifecycle_counts
const COUNTS = r => r?.json?.counts || {}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const require = createRequire(join(ROOT, 'package.json'))
const Database = require('better-sqlite3')

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (opts.cookie) headers.Cookie = opts.cookie
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET', headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: res.status, json, text, res }
}
const cookieFrom = res => (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ')

// ── 起应用 ──
let appProcess = null
/**
 * 注册通道的 Turnstile 默认开启（fail-closed），测试环境拿不到真 token，
 * 故把 `register_turnstile_enabled` 置 false —— 与 scripts/state-machine.mjs、
 * scripts/third-batch-server.mjs、scripts/second-batch-e2e.mjs 同一手法。
 * 必须在应用启动后调用：`system_config` 表由应用建库时创建。
 * `getConfig()` 每次读库、不缓存，所以运行中改即时生效。
 */
function disableRegisterChallenge() {
  const db = new Database(DB)
  db.prepare(
    "INSERT INTO system_config(key,value) VALUES('register_turnstile_enabled','false') "
    + "ON CONFLICT(key) DO UPDATE SET value='false'",
  ).run()
  db.close()
}
async function startApp() {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) {
    console.error('未找到 .output/server/index.mjs —— 请先 `pnpm build`')
    process.exit(1)
  }
  const logs = []
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      NUXT_DB_PATH: DB,
      NUXT_ADMIN_USERS: ADMIN_USER,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', d => logs.push(String(d)))
  appProcess.stderr.on('data', d => logs.push(String(d)))
  let earlyExit = null
  appProcess.on('exit', (code, signal) => { earlyExit = { code, signal }; appProcess = null })
  const start = Date.now()
  while (Date.now() < start + 40_000) {
    if (earlyExit) throw new Error(`应用启动即退出（code=${earlyExit.code}）：\n${logs.join('').slice(-800)}`)
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return logs } catch { /* 还没起来 */ }
    await sleep(400)
  }
  throw new Error('应用 40s 内未就绪')
}
async function stopApp() {
  if (!appProcess) return
  const proc = appProcess
  appProcess = null
  const exited = new Promise(resolve => proc.on('exit', resolve))
  proc.kill('SIGTERM')
  const done = await Promise.race([exited, sleep(8000).then(() => 'timeout')])
  if (done === 'timeout') { proc.kill('SIGKILL'); await Promise.race([exited, sleep(3000)]) }
}

/**
 * 播种面板数据。
 *
 * 覆盖面是**刻意**铺满的：每个筛选维度都至少两档有值，否则筛选测试会「真空通过」
 * （期望 0 条、实际 0 条，看起来绿，其实什么都没测）。
 *   · 24 条面板行：三档 lifecycle 各 6 条（deleted / votes / manual / expired 轮流）
 *   · 4 个分类 × 6 条、2 档品质各 12 条、2 个地区各 12 条、2 个来源各 12/12 条
 *   · 发布者：guest(user_id=0 → 种子用户 _system) 与 user(user_id=1) 各 12 条
 *   · 关键词：i%6===0 的 provider/title 含 'Step'；i%3===0 的 provider 含 'a'；
 *     i===7 的 title 含 '%'（用于验证 LIKE 通配符被转义）
 *   · 另有 6 条**在架**行（pending/published），用于证明两个视图互不重叠、队列口径未被破坏
 */
const CATS = ['token', 'cloud', 'domain', 'client']
const KINDS = ['deleted', 'votes', 'manual', 'expired']
const REGIONS = ['cn', 'global']
const QUALITIES = ['上品', '中品']
const PANEL_N = 24
const LIVE_N = 6

function seed() {
  const db = new Database(DB)
  const now = Date.now()
  const ins = db.prepare(
    `INSERT INTO token_deals (id, user_id, provider, title, url, category, state, status,
      created_at, updated_at, source_tag, quality, region, invalid_reason, invalid_at, deleted_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const panel = []
  for (let i = 0; i < PANEL_N; i++) {
    const kind = KINDS[Math.floor(i / 4) % 4]          // 每档 6 条，且各档横跨 4 个分类
    const category = CATS[i % 4]
    // ⚠️ 各维度必须用**互质/错开**的循环下标，不能都用 `i % n`：
    // 第一版 category 与 region 都挂在 i 的奇偶上，于是 `category=cloud` 恒为 `region=cn`，
    // 「组合筛选」里那条 cloud+global 就成了**永不为真的真空用例**（测试自己报了出来）。
    const region = REGIONS[Math.floor(i / 4) % 2]
    const quality = QUALITIES[Math.floor(i / 2) % 2]
    const sourceTag = i % 3 === 0 ? 'community' : 'official'
    const userId = i % 2 === 0 ? 0 : 1                 // 0 = 游客（_system），1 = 注册用户
    const provider = i % 3 === 0 ? `api-vendor-${i}` : `供应商-${i}`
    const title = (i % 6 === 0 ? `Step 特惠 ${i}` : `特惠通告 ${i}`) + (i === 7 ? ' 50% 折扣' : '')
    const isDeleted = kind === 'deleted'
    const isExpired = kind === 'expired'
    ins.run(
      `panel_${i}`, userId, provider, title, `https://example.com/p/${i}`, category,
      isDeleted ? 'deleted' : 'invalid',
      isDeleted ? 'approved' : 'approved',
      now - (PANEL_N - i) * 60_000, now - (PANEL_N - i) * 60_000,
      sourceTag, quality, region,
      isDeleted ? '' : kind === 'expired' ? 'expired' : kind,   // votes / manual / expired
      isDeleted ? null : now - 3600_000,
      isDeleted ? now - 3600_000 : null,
      isExpired ? now - 7200_000 : null,
    )
    panel.push({ id: `panel_${i}` })
  }
  // 在架行：不得出现在失效面板里；供队列视图回归
  for (let i = 0; i < LIVE_N; i++) {
    const state = i < 4 ? 'pending' : 'published'
    ins.run(
      `live_${i}`, 1, `live-vendor-${i}`, `在架通告 ${i}`, `https://example.com/l/${i}`, 'token',
      state, i < 4 ? 'pending' : 'approved',
      now - i * 60_000, now - i * 60_000,
      'official', '中品', 'cn', '', null, null,
      now + 30 * 86400_000,                                  // 未到期
    )
  }
  db.close()
}

// ── 主流程 ──
let exitCode = 0
try {
  await startApp()
  disableRegisterChallenge()

  // 注册并登录（管理员身份来自 NUXT_ADMIN_USERS 旁路，照仓库既有套件惯例，不碰种子密码）
  const reg = await api('/api/auth/register', { method: 'POST', body: { username: ADMIN_USER, password: PASSWORD } })
  check('管理员账号注册成功', reg.status === 200 || reg.status === 201, `status=${reg.status} ${reg.text.slice(0, 160)}`)
  const login = await api('/api/auth/login', { method: 'POST', body: { username: ADMIN_USER, password: PASSWORD } })
  check('管理员登录成功', login.status === 200, `status=${login.status} ${login.text.slice(0, 200)}`)
  const cookie = cookieFrom(login.res)
  if (!cookie) throw new Error('未拿到会话 cookie')

  // 数据在登录后播种（迁移已建表）。
  //
  // ⚠️ 迁移会**预置 10 条 `published` 示例通告**（`deal_17942...`，真实站点导览用），
  // 它们计入「在架」口径。所以下面所有断言都相对**播种前基线**取增量，
  // 不假设库是空的 —— 第一版直接写死 `24 + 6` 就是被这 10 条打回的。
  const seededBefore = (() => {
    const db = new Database(DB, { readonly: true })
    const row = db.prepare('SELECT COUNT(*) c FROM token_deals').get()
    db.close()
    return row.c
  })()
  /** 迁移预置的 10 条是 `published`，同样计入「在架」——队列断言必须按增量算 */
  const liveBefore = (() => {
    const db = new Database(DB, { readonly: true })
    const row = db.prepare(
      "SELECT COUNT(*) c FROM token_deals WHERE state IN ('pending','verified','published')"
      + ' AND (expires_at IS NULL OR expires_at > ?)',
    ).get(Date.now())
    db.close()
    return row.c
  })()
  seed()
  const rowCountBefore = (() => {
    const db = new Database(DB, { readonly: true })
    const c = db.prepare('SELECT COUNT(*) c FROM token_deals').get().c
    db.close()
    return c
  })()
  check(`播种后库内行数 == 迁移预置 ${seededBefore} + 播种 ${PANEL_N + LIVE_N}`,
    rowCountBefore === seededBefore + PANEL_N + LIVE_N, String(rowCountBefore))

  // ── 基线：面板全量 ──
  const base = await api('/api/admin/token-deals?view=invalid&limit=100&page=1', { cookie })
  check('未筛选面板 200', base.status === 200, String(base.status))
  const rows = DEALS(base)
  const total0 = TOT(base)
  check('面板总数 == 面板行数（在架行未混入）', total0 === PANEL_N && rows.length === PANEL_N,
    `total=${total0} rows=${rows.length} 期望=${PANEL_N}`)

  // 客户端独立判定（口径取自 server/api/admin/token-deals/index.get.ts 的 classify() 语义）
  const isDeleted = r => r.state === 'deleted'
  const isExpired = r => r.state === 'invalid' && r.invalid_reason === 'expired'
  const isInvalid = r => r.state === 'invalid' && r.invalid_reason !== 'expired'
  const inPanel = r => isDeleted(r) || isExpired(r) || isInvalid(r)
  check('全量行都属面板三类（服务端未混入在架条目）', rows.every(inPanel))

  const exp = {
    deleted: rows.filter(isDeleted).length,
    expired: rows.filter(isExpired).length,
    invalid: rows.filter(isInvalid).length,
  }
  check('三档在播种数据里都非空（否则下面的分档断言是真空通过）',
    exp.deleted > 0 && exp.expired > 0 && exp.invalid > 0, JSON.stringify(exp))

  const lc = LC(base)
  check('lifecycle_counts 存在', !!lc, JSON.stringify(lc))
  check('lifecycle_counts.all == total', lc && lc.all === total0, `${lc?.all} vs ${total0}`)
  for (const k of ['deleted', 'expired', 'invalid']) {
    check(`lifecycle_counts.${k} == 客户端独立计数`, lc && lc[k] === exp[k], `${lc?.[k]} vs ${exp[k]}`)
  }
  check('三档之和 == 面板总数', exp.deleted + exp.expired + exp.invalid === total0,
    `${exp.deleted}+${exp.expired}+${exp.invalid} vs ${total0}`)
  check('服务端 lifecycle 字段与三类判定一致',
    rows.every(r => (isDeleted(r) ? r.lifecycle === 'deleted' : isExpired(r) ? r.lifecycle === 'expired' : r.lifecycle === 'invalid')))

  // 库内直读交叉核对（第三方口径，既不是后端也不算客户端）
  {
    const db = new Database(DB, { readonly: true })
    const q = (sql) => db.prepare(sql).get().c
    const dbDeleted = q("select count(*) c from token_deals where state = 'deleted'")
    const dbInvalid = q("select count(*) c from token_deals where state = 'invalid' and COALESCE(invalid_reason,'') <> 'expired'")
    const dbExpired = q("select count(*) c from token_deals where state = 'invalid' and COALESCE(invalid_reason,'') = 'expired'")
    db.close()
    check('库内直读三档计数 == API lifecycle_counts',
      dbDeleted === exp.deleted && dbInvalid === exp.invalid && dbExpired === exp.expired,
      `db=${dbDeleted}/${dbInvalid}/${dbExpired} api=${exp.deleted}/${exp.invalid}/${exp.expired}`)
  }

  // ── 逐档 lifecycle 筛选 ──
  console.log('\n[分档 lifecycle]')
  for (const k of ['deleted', 'expired', 'invalid']) {
    const r = await api(`/api/admin/token-deals?view=invalid&lifecycle=${k}&limit=100`, { cookie })
    const ids = new Set(DEALS(r).map(d => d.id))
    const expectIds = new Set(rows.filter({ deleted: isDeleted, expired: isExpired, invalid: isInvalid }[k]).map(d => d.id))
    const same = ids.size === expectIds.size && [...ids].every(i => expectIds.has(i))
    check(`lifecycle=${k} 返回集合正确`, same && TOT(r) === expectIds.size,
      `api=${ids.size}/${TOT(r)} expect=${expectIds.size}`)
  }

  // ── 业务属性筛选（逐参数对比客户端独立筛选）──
  console.log('\n[业务属性 / 失效原因 / 发布者]')
  const cases = [
    ['category', 'token', r => r.category === 'token'],
    ['category', 'cloud', r => r.category === 'cloud'],
    ['category', 'domain', r => r.category === 'domain'],
    ['category', 'client', r => r.category === 'client'],
    ['quality', '上品', r => r.quality === '上品'],
    ['quality', '中品', r => r.quality === '中品'],
    ['region', 'cn', r => r.region === 'cn'],
    ['region', 'global', r => r.region === 'global'],
    ['source_tag', 'community', r => r.source_tag === 'community'],
    ['source_tag', 'official', r => r.source_tag === 'official'],
    ['invalid_reason', 'votes', r => r.invalid_reason === 'votes'],
    ['invalid_reason', 'manual', r => r.invalid_reason === 'manual'],
    ['invalid_reason', 'expired', r => r.invalid_reason === 'expired'],
    ['origin', 'guest', r => r.user_id === 0],
    ['origin', 'user', r => r.user_id > 0],
  ]
  const vacuous = cases.filter(([, , pred]) => rows.filter(pred).length === 0)
  check('每个筛选档位都有命中（无真空用例）', vacuous.length === 0,
    vacuous.map(c => `${c[0]}=${c[1]}`).join('、'))
  for (const [key, val, pred] of cases) {
    const expect = rows.filter(pred)
    const r = await api(`/api/admin/token-deals?view=invalid&limit=100&${key}=${encodeURIComponent(val)}`, { cookie })
    const ids = new Set(DEALS(r).map(d => d.id))
    const expectIds = new Set(expect.map(d => d.id))
    const same = ids.size === expectIds.size && [...ids].every(i => expectIds.has(i))
    check(`${key}=${val}（期望 ${expect.length} 条）`, same && TOT(r) === expect.length,
      `api=${ids.size}/${TOT(r)} expect=${expect.length}`)
  }

  // ── 组合筛选 ──
  console.log('\n[组合]')
  const combos = [
    ['category=cloud&region=global', r => r.category === 'cloud' && r.region === 'global'],
    ['lifecycle=deleted&origin=user', r => isDeleted(r) && r.user_id > 0],
    ['lifecycle=invalid&invalid_reason=votes', r => isInvalid(r) && r.invalid_reason === 'votes'],
    ['quality=中品&origin=guest', r => r.quality === '中品' && r.user_id === 0],
  ]
  const vacuousCombo = combos.filter(([, pred]) => rows.filter(pred).length === 0)
  check('每个组合都有命中（无真空用例）', vacuousCombo.length === 0, vacuousCombo.map(c => c[0]).join('、'))
  for (const [qs, pred] of combos) {
    const expect = rows.filter(pred)
    const r = await api(`/api/admin/token-deals?view=invalid&limit=100&${qs}`, { cookie })
    const ids = new Set(DEALS(r).map(d => d.id))
    const expectIds = new Set(expect.map(d => d.id))
    const same = ids.size === expectIds.size && [...ids].every(i => expectIds.has(i))
    check(`${qs}（期望 ${expect.length} 条）`, same && TOT(r) === expect.length,
      `api=${ids.size}/${TOT(r)} expect=${expect.length}`)
  }

  // ── 关键词搜索 ──
  console.log('\n[关键词]')
  // SQLite 的 LIKE 对 ASCII 大小写不敏感（默认），期望值必须用同一口径
  const ci = s => String(s || '').toLowerCase()
  for (const kw of ['Step', 'a', 'zzz-不存在-zzz']) {
    const expect = rows.filter(r => ci(r.provider).includes(ci(kw)) || ci(r.title).includes(ci(kw)))
    const r = await api(`/api/admin/token-deals?view=invalid&limit=100&search=${encodeURIComponent(kw)}`, { cookie })
    check(`search=${kw}（期望 ${expect.length} 条）`, TOT(r) === expect.length,
      `api=${TOT(r)} expect=${expect.length}`)
  }
  // 通配符必须被转义：`%` 单独作为关键词不应命中全部
  {
    const r = await api('/api/admin/token-deals?view=invalid&limit=100&search=%25', { cookie })
    const expect = rows.filter(r2 => ci(r2.provider).includes('%') || ci(r2.title).includes('%'))
    check('search=% 被当作字面量（未转义会命中全部）', TOT(r) === expect.length,
      `api=${TOT(r)} expect=${expect.length} total=${total0}`)
  }

  // ── 计数一致性：筛选后 chip 数字 ──
  console.log('\n[筛选下的分档计数]')
  {
    const r = await api('/api/admin/token-deals?view=invalid&limit=100&origin=guest', { cookie })
    const sub = rows.filter(x => x.user_id === 0)
    const e = { deleted: sub.filter(isDeleted).length, expired: sub.filter(isExpired).length, invalid: sub.filter(isInvalid).length }
    const c = LC(r)
    check('origin=guest 下 lifecycle_counts.all == 该筛选总数', c.all === sub.length, `${c.all} vs ${sub.length}`)
    for (const k of ['deleted', 'expired', 'invalid']) {
      check(`origin=guest 下 ${k} 分档计数正确`, c[k] === e[k], `${c[k]} vs ${e[k]}`)
    }
    check('筛选后 chip 数字 != 全站数字（口径确实变了）',
      c.deleted !== exp.deleted || c.invalid !== exp.invalid || c.expired !== exp.expired, JSON.stringify(c))
  }

  // ── 失效原因属于「筛选」而非「分档」：必须计入 chip 计数 ──
  console.log('\n[失效原因 × 分档计数（口径一致性）]')
  {
    const r = await api('/api/admin/token-deals?view=invalid&limit=100&invalid_reason=votes', { cookie })
    const sub = rows.filter(x => x.invalid_reason === 'votes')
    const c = LC(r)
    check('reason=votes 下列表总数 == 客户端独立计数', TOT(r) === sub.length,
      `${TOT(r)} vs ${sub.length}`)
    check('reason=votes 下 lifecycle_counts.all == 列表总数（不再「chip 说 15、列表说 2」）',
      c.all === TOT(r), `${c.all} vs ${TOT(r)}`)
    const e = { deleted: sub.filter(isDeleted).length, expired: sub.filter(isExpired).length, invalid: sub.filter(isInvalid).length }
    for (const k of ['deleted', 'expired', 'invalid']) {
      check(`reason=votes 下 ${k} 分档计数正确`, c[k] === e[k], `${c[k]} vs ${e[k]}`)
    }
    const combo = await api('/api/admin/token-deals?view=invalid&limit=100&invalid_reason=votes&lifecycle=invalid', { cookie })
    check('reason=votes + lifecycle=invalid 叠加后 == 该筛选项数',
      TOT(combo) === sub.filter(isInvalid).length,
      `${TOT(combo)} vs ${sub.filter(isInvalid).length}`)
  }
  {
    const withReason = await api('/api/admin/token-deals?view=queue&status=all&limit=100&invalid_reason=votes', { cookie })
    const without = await api('/api/admin/token-deals?view=queue&status=all&limit=100', { cookie })
    check('队列视图忽略 invalid_reason', TOT(withReason) === TOT(without),
      `${TOT(withReason)} vs ${TOT(without)}`)
  }

  // ── 非法值回退 ──
  console.log('\n[非法值 / 注入]')
  const bads = [
    'category=bogus', 'quality=bogus', 'region=bogus', 'source_tag=bogus',
    'invalid_reason=bogus', 'origin=bogus', 'lifecycle=bogus',
    "category=token' OR '1'='1", "origin=guest'); DROP TABLE token_deals;--",
    'search=%27%20OR%201%3D1%20--',
  ]
  for (const qs of bads) {
    const r = await api(`/api/admin/token-deals?view=invalid&limit=100&${qs}`, { cookie })
    check(`非法入参不报错：${qs.slice(0, 46)}`, r.status === 200, String(r.status))
  }
  {
    const r = await api('/api/admin/token-deals?view=invalid&limit=100&category=bogus&origin=nope', { cookie })
    check('非法枚举退化为「不筛」（等于基线）', TOT(r) === total0, `${TOT(r)} vs ${total0}`)
  }
  {
    const r = await api('/api/admin/token-deals?view=invalid&limit=100&lifecycle=bogus', { cookie })
    check('lifecycle=bogus 退化为「全部分档」', TOT(r) === total0, `${TOT(r)} vs ${total0}`)
  }
  {
    const r = await api('/api/admin/token-deals?view=invalid&limit=100&status=pending', { cookie })
    check('失效面板忽略 status 参数（status 只属队列视图）', TOT(r) === total0, `${TOT(r)} vs ${total0}`)
  }
  {
    // 注入前后行数自比（不写死数字）
    const db = new Database(DB, { readonly: true })
    const n = db.prepare('SELECT COUNT(*) c FROM token_deals').get().c
    check('注入尝试未破坏库（行数不变）', n === rowCountBefore, `${n} vs ${rowCountBefore}`)
    db.close()
  }

  // ── 分页 ──
  console.log('\n[分页]')
  {
    const p1 = await api('/api/admin/token-deals?view=invalid&limit=5&page=1', { cookie })
    const p2 = await api('/api/admin/token-deals?view=invalid&limit=5&page=2', { cookie })
    check('limit=5 第 1 页返回 5 行', DEALS(p1).length === 5)
    check('两页无重叠', DEALS(p1).every(a => !DEALS(p2).some(b => b.id === a.id)))
    check('分页不改变 total', TOT(p1) === total0 && TOT(p2) === total0)
    check('totalPages 正确', PAGES(p1) === Math.ceil(total0 / 5), String(PAGES(p1)))
    const pf = await api('/api/admin/token-deals?view=invalid&limit=5&page=2&origin=user', { cookie })
    check('分页 + 筛选共存', pf.status === 200 && TOT(pf) === rows.filter(x => x.user_id > 0).length,
      `${TOT(pf)}`)
  }

  // ── 队列视图回归（新参数不得破坏队列口径）──
  console.log('\n[队列视图回归]')
  {
    const q = await api('/api/admin/token-deals?view=queue&status=all&limit=100', { cookie })
    check('队列视图 200', q.status === 200)
    check('队列视图不返回 lifecycle_counts（或为 null）', !LC(q), JSON.stringify(LC(q)))
    const qrows = DEALS(q)
    check('队列只含在架条目', qrows.every(r => ['pending', 'verified', 'published'].includes(r.state)))
    check(`队列行数 == 迁移预置在架 ${liveBefore} + 播种在架 ${LIVE_N}`,
      qrows.length === liveBefore + LIVE_N, `${qrows.length} vs ${liveBefore + LIVE_N}`)
    {
      // counts 是全站口径、与筛选无关 —— 用库内同谓词独立复算
      const db = new Database(DB, { readonly: true })
      const livePending = db.prepare(
        "select count(*) c from token_deals where state = 'pending' and (expires_at is null or expires_at > ?)",
      ).get(Date.now()).c
      db.close()
      check('队列 counts.pending 与库内在架 pending 同口径', COUNTS(q).pending === livePending,
        `api=${COUNTS(q).pending} db=${livePending}`)
    }

    const qg = await api('/api/admin/token-deals?view=queue&status=all&limit=100&origin=guest', { cookie })
    check('队列也吃 origin 参数（通用筛选）', qg.status === 200 && DEALS(qg).every(r => r.user_id === 0),
      `total=${TOT(qg)}`)

    const qh = await api('/api/admin/token-deals?view=queue&status=all&limit=100&search=在架', { cookie })
    check('队列 search 未被破坏', qh.status === 200 && TOT(qh) > 0, `total=${TOT(qh)}`)

    const qv = await api('/api/admin/token-deals?view=queue&status=published&limit=100&verify=stale', { cookie })
    check('待核验筛选未破坏', qv.status === 200)
  }

  // ── 越权回归 ──
  console.log('\n[鉴权]')
  {
    const anon = await api('/api/admin/token-deals?view=invalid&category=cloud')
    check('未登录 401/403', anon.status === 401 || anon.status === 403, String(anon.status))
  }
} catch (e) {
  // ⚠️ 异常必须计入 fail，否则摘要会打印「N 通过 / 0 失败」而退出码却是 1 ——
  // 同一类误导（报错信息与实际结果相反）在 assertion-count.mjs 里也修过一次。
  exitCode = 1
  bad('套件执行中断（未跑完就抛异常）', e?.message || String(e))
  console.error('!! 测试异常：', e?.message || e)
} finally {
  await stopApp()
  try { rmSync(WORK, { recursive: true, force: true }) } catch { /* ignore */ }
  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)) }
  process.exit(fail ? 1 : exitCode)
}
