#!/usr/bin/env node
/**
 * third-batch-server.mjs — 第三批服务端改动 端到端 + 单元冒烟（自包含，node 直跑）
 *
 * 先决条件：`pnpm build` 已产出 `.output/`（本脚本只起产物，不编译）。
 * 端口固定 3262；临时库全部落在 /tmp（跑完自动清），不碰 data/。
 *
 * ## ⚠️ Node 版本必须与 `.output` 的构建版本一致，且该版本需 ≥22.6
 *
 * 本脚本有两处对 Node 版本敏感，且方向**相反**：
 *
 *   1. `spawn('node', ['.output/server/index.mjs'])` —— 拿 PATH 上的 node 起产物。
 *      better-sqlite3 是原生模块，ABI 与 Node 大版本绑定；版本错了只会看到
 *      `应用启动即退出（code=1）`，真实原因藏在子进程 stderr 的
 *      `NODE_MODULE_VERSION 115 / 127` 里。
 *   2. `await import(... 'invite-codes.ts')` —— 直接加载 `.ts` 源码做纯函数单测，
 *      需要 **Node ≥22.6**（`--experimental-strip-types`）。Node 20 会报
 *      `ERR_UNKNOWN_FILE_EXTENSION`，而且 20 根本不认这个 flag。
 *
 * 所以：**`.output` 用哪个 Node 构建，就得用那个 Node 跑；而那个 Node 必须 ≥22.6。**
 * 本机常见混装（node_modules/.output 由 Node 20 装出，PATH 上是 Node 22）会两头堵：
 * 用 20 跑 → `.ts` 加载失败；用 22 跑 → ABI 不匹配（2026-10-31 两种都实测过）。
 *
 * 解法：CI 里天然满足（setup-node 22 → install → build → run 全用 22）；
 * 本机想跑，先用 ≥22.6 的版本做一次 `pnpm install` + `pnpm build`。
 *
 * 覆盖 2026-10-30 第三批的服务端部分：
 *   ① 领取地址 `{邀请码}` 占位符
 *      · 三种兼容写法（`{邀请码}` / `{code}` / `{invite_code}`）+ 全角花括号
 *      · 替换值一律 encodeURIComponent（含 `&` `=` 空格 `/` 中文 `$&` 的码）
 *      · **只在「已抽中该码」的响应里替换**：详情/列表既无码也无 `claim_url` 字段
 *      · **模板有占位符但码池为空**：`claim_url` 是空串，响应里连占位符都不出现
 *   ② 是否实名 `real_name` / `real_name_other`
 *      · 四值写入-读出正确（Web 新建 / Web 编辑 / 建议通道 / AI patch / 游客通道 五条写路径）
 *      · 非法值经**每条通道**都被拒（同一个校验函数，没有旁路）
 *      · `real_name !== 'other'` 时清空 `real_name_other` 的规则在所有通道一致
 *      · 存量 80 条数据迁移后可读（空串，不是 NULL）
 *   ③ `/tokens` 默认排序 = 最新（`sort=nexus` 改为显式传参）
 *   ④ AI 通道文档同步 + 内部字段不回归（verified_by / guest_fingerprint / deleted_by）
 *   ⑤ 顺手修的既有缺陷：AI 通道 `category` 静默丢弃（INSERT / merged / compare / UPDATE）
 *
 * ### 两条诚实的边界（不夸大成"已验证"）
 *
 * 1. **游客发布走不到 HTTP 层**：`submitGuestDeal` 的人机校验是 fail-closed，且 Cloudflare
 *    官方测试密钥被代码显式判为「未启用」（见 `utils/turnstile.ts` 的 TEST_KEY_RE），
 *    所以 `POST /api/token-deals`（未登录）在测试环境必然 400。故游客写路径用**模块级测试**：
 *    把真实 `guest-deals.ts` / `token-deals.ts` 复制到临时目录，只把「防滥用层」
 *    （human-check / spam / guest-reviews 身份）换成桩，**INSERT 与字段校验跑的是真实源码**。
 * 2. 迁移动的是**真库结构**：第二个用例专门造"旧库 + 80 条存量数据"（把新列 DROP 掉再重启）
 *    来验证幂等与存量可读，而不是只在空库上跑一遍。
 *
 * 用法：node scripts/third-batch-server.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3262
const BASE = `http://127.0.0.1:${APP_PORT}`
const PASSWORD = 'E2e#Pass2026'
/** 临时工作目录：库、模块副本、桩都放这里，跑完删掉 */
const WORK = mkdtempSync(join(tmpdir(), 'favshub-third-'))

let passCount = 0
let failCount = 0
const failures = []
/** 未验证项（例如缺少生产快照）：既不算通过也不算失败，但在收尾时明确列出 */
const skipped = []
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function ok(msg) { passCount++; console.log(`  ✓ ${msg}`) }
function bad(desc, detail) {
  failCount++
  failures.push(`${desc}${detail ? ' — ' + detail : ''}`)
  console.error(`  ✗ ${desc}${detail ? ' — ' + detail : ''}`)
}
function check(desc, cond, detail) { cond ? ok(desc) : bad(desc, detail) }
/** 浅显易读的"相等"断言：失败时把两侧值都打出来 */
function checkEq(desc, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(desc, a === e, `实际 ${a} ≠ 期望 ${e}`)
}

// ── HTTP ────────────────────────────────────────────────────
async function api(path, { method = 'GET', cookie, body, headers: extra } = {}) {
  const headers = { ...(extra || {}) }
  if (cookie) headers.Cookie = cookie
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* HTML */ }
  return { status: res.status, json, text, res }
}
function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  return list.map(c => c.split(';')[0]).filter(Boolean).join('; ')
}

// ── 数据库直读（断言"真的落库了"，不看接口自述）───────────
function requireFromRoot(mod) {
  return createRequire(join(ROOT, 'package.json'))(mod)
}
function withDb(dbPath, fn) {
  const Database = requireFromRoot('better-sqlite3')
  const db = new Database(dbPath)
  try { return fn(db) } finally { db.close() }
}
function dealRow(dbPath, id) {
  return withDb(dbPath, db => db.prepare(
    'SELECT id, real_name, real_name_other, category, url, call_url, status FROM token_deals WHERE id = ?'
  ).get(id))
}
function scalar(dbPath, sql, ...params) {
  return withDb(dbPath, db => {
    const row = db.prepare(sql).get(...params)
    return row ? Object.values(row)[0] : undefined
  })
}
/** 读 QQ outbox spool（`qq_bot_transport=outbox` 下每条通知落一个 JSON），按文件名（=时间序）排序 */
function spoolEntries(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(n => n.endsWith('.json')).sort().map((file) => {
    try { return { file, entry: JSON.parse(readFileSync(join(dir, file), 'utf8')) } } catch { return { file, entry: null } }
  })
}
/**
 * 等 spool 里至少出现 min 条新文件。
 *
 * 通知是**入队 + 1s 定时 flush** 的（`enqueue` → `ensureFlushTimer`），
 * HTTP 响应返回时文件通常还没落地 —— 立刻读会稳定拿到空数组，
 * 那是脚本的时序问题，不是功能问题（T4 的脚本同样用轮询）。
 */
async function waitSpool(dir, min, desc, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (spoolEntries(dir).length >= min) return spoolEntries(dir)
    await sleep(150)
  }
  console.error(`  ⚠ spool 等待超时（${desc}）：期望 ≥${min} 条，实际 ${spoolEntries(dir).length} 条`)
  return spoolEntries(dir)
}
/**
 * 关掉「注册人机校验」。
 *
 * 注册通道的 Turnstile 默认开启，测试环境拿不到真 token；这里只把
 * `register_turnstile_enabled` 置 false（与 scripts/second-batch-e2e.mjs 同一手法）。
 * 注意：**游客发布通道不读这个开关**（恒 fail-closed），所以游客写路径只能走模块级测试。
 */
function disableRegisterChallenge(dbPath) {
  withDb(dbPath, db => db.prepare(
    "INSERT INTO system_config(key,value) VALUES('register_turnstile_enabled','false') "
    + "ON CONFLICT(key) DO UPDATE SET value='false'"
  ).run())
}

// ── 应用进程 ────────────────────────────────────────────────
let appProcess = null
function ensureNativeModule() {
  const load = () => { try { requireFromRoot('better-sqlite3'); return true } catch { return false } }
  if (!load()) {
    console.log('  ⚠ better-sqlite3 与当前 node ABI 不匹配，尝试 pnpm rebuild …')
    spawnSync('pnpm', ['rebuild', 'better-sqlite3'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (!load()) throw new Error('better-sqlite3 无法在 node ' + process.version + ' 下加载')
  }
}
/**
 * 起服务并**收集 stdout**（迁移日志断言要用）。
 * 返回的 logs 数组是持续追加的引用，stopApp() 后仍是本次启动的完整日志。
 *
 * 两道保险，缺一不可（这里踩过坑，写清楚免得后人再踩）：
 *   1. 起之前先**探端口**：上一个实例若还占着 3262，新进程会 EADDRINUSE 直接死，
 *      而 `/api/announcements` 探测会被**旧进程**应答 → 误判"起来了"，
 *      于是后面的 HTTP 断言全打在旧库上（现象：迁移日志全空、数据"没变"，极具误导性）。
 *   2. 起之后监听 child 的 early-exit：一旦退出立刻带着它的日志抛错，而不是干等 40s。
 */
async function startApp(dbPath) {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 `pnpm build`'); process.exit(1) }
  ensureNativeModule()
  await waitPortFree()
  const logs = []
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), NUXT_DB_PATH: dbPath, NUXT_ADMIN_USERS: 'e2eadmin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', (d) => { logs.push(String(d)) })
  appProcess.stderr.on('data', (d) => {
    const s = String(d)
    logs.push(s)
    // 迁移失败类日志必须显眼：本批最怕"迁移静默没跑"
    if (/\[DB\].*(迁移|失败)/.test(s)) console.error(`  [app] ${s.trim().slice(0, 400)}`)
  })
  let earlyExit = null
  appProcess.on('exit', (code, signal) => { earlyExit = { code, signal }; appProcess = null })
  const start = Date.now()
  while (Date.now() < start + 40_000) {
    if (earlyExit) throw new Error(`应用启动即退出（code=${earlyExit.code} signal=${earlyExit.signal}）：\n${logs.join('').slice(-800)}`)
    try { const r = await fetch(`${BASE}/api/announcements`); if (r.ok) return logs } catch { /* 还没起来 */ }
    await sleep(400)
  }
  throw new Error('应用 40s 内未就绪')
}
/** 端口占用检测：能连上就说明还有别的进程在听 3262 */
async function waitPortFree(timeoutMs = 15_000) {
  const start = Date.now()
  while (Date.now() < start + timeoutMs) {
    let busy = false
    try { await fetch(`${BASE}/api/announcements`, { signal: AbortSignal.timeout(1500) }); busy = true } catch { /* 空闲 */ }
    if (!busy) return
    await sleep(300)
  }
  throw new Error(`端口 ${APP_PORT} 仍被占用（上一次启动的实例没退干净）`)
}
async function stopApp() {
  if (!appProcess) return
  const proc = appProcess
  appProcess = null
  const exited = new Promise((resolve) => proc.on('exit', resolve))
  proc.kill('SIGTERM')
  // 等它真的退出：SQLITE 的 WAL checkpoint + 备份调度都要收尾，
  // 没退干净就起下一个会撞 EADDRINUSE（现象见 startApp 注释）
  const ok = await Promise.race([exited, sleep(8000).then(() => 'timeout')])
  if (ok === 'timeout') {
    proc.kill('SIGKILL')
    await Promise.race([exited, sleep(3000)])
  }
}

// ════════════════════════════════════════════════════════════
// 0. 纯函数单测：占位符替换（加载真实源码，只给 ./jwt 放桩）
//
// 为什么必须单测：替换逻辑最怕"某条分支忘了编码"，而 HTTP 层只能覆盖到少数几种码。
// 做法沿用 scripts/private-ip-check.mjs 的既有手法（复制源码 + 给依赖放桩 + 改写一处导入），
// 保证跑的是**真实实现**而不是另一份复制粘贴。
// ════════════════════════════════════════════════════════════
async function loadInviteCodesModule() {
  const dir = mkdtempSync(join(tmpdir(), 'claimurl-'))
  writeFileSync(join(dir, 'jwt.ts'), "export const getSecret = () => 'unit-test-secret'\n")
  const src = readFileSync(join(ROOT, 'server', 'utils', 'invite-codes.ts'), 'utf8')
  const code = src.replace("from './jwt'", "from './jwt.ts'")
  if (!code.includes("from './jwt.ts'")) throw new Error('导入改写失败：invite-codes.ts 的 ./jwt 导入可能已变动')
  writeFileSync(join(dir, 'invite-codes.ts'), code)
  return await import(pathToFileURL(join(dir, 'invite-codes.ts')).href)
}

async function unitClaimUrl() {
  console.log('\n▶ ①-0 占位符替换（纯函数单测）')
  const mod = await loadInviteCodesModule()
  const { resolveClaimUrl, hasClaimCodePlaceholder, claimUrlTemplateOf } = mod
  check('真实源码已加载出 resolveClaimUrl / hasClaimCodePlaceholder / claimUrlTemplateOf',
    typeof resolveClaimUrl === 'function' && typeof hasClaimCodePlaceholder === 'function'
    && typeof claimUrlTemplateOf === 'function')

  const LY = 'https://platform.lyrouter.com/ai_gateway/workspace/login?action=register&referral_code={邀请码}&share_v=2'

  // 需求原文的示例 URL + 带 & = 的码：不编码会把 URL 截断
  checkEq('{邀请码} 在 query 里被替换且编码（& = 变成 %26 %3D）',
    resolveClaimUrl(LY, 'LRT&CODE=1'),
    'https://platform.lyrouter.com/ai_gateway/workspace/login?action=register&referral_code=LRT%26CODE%3D1&share_v=2')

  // 三种兼容写法
  const tpl = (name) => `https://x.com/reg?ref=${name}`
  const three = ['{邀请码}', '{code}', '{invite_code}'].map(n => resolveClaimUrl(tpl(n), 'A B'))
  checkEq('三种占位符写法都生效且都编码', three, ['https://x.com/reg?ref=A%20B', 'https://x.com/reg?ref=A%20B', 'https://x.com/reg?ref=A%20B'])
  check('三种写法都替换成功（无残留花括号）', three.every(v => !v.includes('{') && !v.includes('}')))

  // 全角花括号（中文输入法的常见误踩）
  checkEq('全角｛邀请码｝同样替换',
    resolveClaimUrl('https://x.com/reg?ref=｛邀请码｝', 'FULL'),
    'https://x.com/reg?ref=FULL')
  checkEq('全角｛code｝同样替换',
    resolveClaimUrl('https://x.com/reg?ref=｛code｝', 'FULL2'),
    'https://x.com/reg?ref=FULL2')

  // 同一个串里多个占位符、混合写法
  checkEq('多个占位符逐个替换（含全角混用）',
    resolveClaimUrl('https://x.com/?a={邀请码}&b=｛code｝&c={invite_code}', 'X/Y'),
    'https://x.com/?a=X%2FY&b=X%2FY&c=X%2FY')

  // 替换值里出现 $& —— String.replace 的字符串参数会把 $& 当"整个匹配"，用函数式替换才安全
  const dollar = resolveClaimUrl('https://x.com/reg?ref={邀请码}', 'a$&b')
  checkEq('码里含 $& 不会被当成替换记号（函数式替换）', dollar, 'https://x.com/reg?ref=a%24%26b')
  check('码里含 $& 时结果里不出现占位符文本', !dollar.includes('邀请码') && !dollar.includes('{'))

  // 中文 / 井号 / 加号
  checkEq('中文码被百分号编码',
    resolveClaimUrl('https://x.com/?r={邀请码}', '中文码'),
    'https://x.com/?r=%E4%B8%AD%E6%96%87%E7%A0%81')
  checkEq('码里的 # 被编码（否则后面全成 fragment）',
    resolveClaimUrl('https://x.com/?r={邀请码}&s=1', 'a#b'),
    'https://x.com/?r=a%23b&s=1')

  // 边界：没码 / 没占位符 / 空模板
  checkEq('没有码时返回空串（绝不填空值凑出残缺 URL）', resolveClaimUrl(LY, ''), '')
  checkEq('没有码（undefined）时返回空串', resolveClaimUrl(LY, undefined), '')
  checkEq('模板没有占位符时原样返回', resolveClaimUrl('https://x.com/claim', 'ABC'), 'https://x.com/claim')
  checkEq('空模板返回空串', resolveClaimUrl('', 'ABC'), '')

  // hasClaimCodePlaceholder：真值表（含反例，避免"永远返回 true"的假绿）
  const truths = ['{邀请码}', '{code}', '{invite_code}', '｛邀请码｝', 'https://a/?r={code}&x=1']
  check('hasClaimCodePlaceholder 对 5 个正例全为 true',
    truths.length === 5 && truths.every(t => hasClaimCodePlaceholder(t) === true),
    JSON.stringify(truths.map(t => [t, hasClaimCodePlaceholder(t)])))
  const falsy = ['', 'https://x.com/claim', '{x}', '{}', '{ 邀请码 }', '邀请码']
  check('hasClaimCodePlaceholder 对 6 个反例全为 false',
    falsy.length === 6 && falsy.every(t => hasClaimCodePlaceholder(t) === false),
    JSON.stringify(falsy.map(t => [t, hasClaimCodePlaceholder(t)])))

  // claimUrlTemplateOf：占位符优先，其次 call_url 优先，最后 url
  const pick = (o) => claimUrlTemplateOf(o).source
  checkEq('只有 url 有占位符 → 用 url', pick({ url: 'https://u/?r={邀请码}', call_url: '' }), 'url')
  checkEq('url 有占位符、call_url 是 API 基址 → 仍用 url（占位符优先）',
    pick({ url: 'https://u/?r={邀请码}', call_url: 'https://api.ex.com/v1' }), 'url')
  checkEq('只有 call_url 有占位符 → 用 call_url',
    pick({ url: 'https://u/', call_url: 'https://api.ex.com/v1?ref={code}' }), 'call_url')
  checkEq('都没占位符、call_url 非空 → 用 call_url', pick({ url: 'https://u/', call_url: 'https://api/v1' }), 'call_url')
  checkEq('都没占位符、call_url 空 → 用 url', pick({ url: 'https://u/', call_url: '' }), 'url')
  checkEq('两个都写占位符 → call_url 优先',
    pick({ url: 'https://u/?r={邀请码}', call_url: 'https://api/v1?ref={code}' }), 'call_url')
  checkEq('两个都空 → url 且模板为空串',
    claimUrlTemplateOf({ url: '', call_url: '' }), { source: 'url', template: '' })
}

// ════════════════════════════════════════════════════════════
// 1. HTTP 端到端（全新临时库）
// ════════════════════════════════════════════════════════════
async function httpSuite(dbPath) {
  // ── 账号 ──
  disableRegisterChallenge(dbPath)
  const reg1 = await api('/api/auth/register', { method: 'POST', body: { username: 'e2eadmin', password: PASSWORD } })
  const reg2 = await api('/api/auth/register', { method: 'POST', body: { username: 'alice', password: PASSWORD } })
  check('管理员账号注册成功', reg1.status === 200, `status=${reg1.status} ${reg1.text.slice(0, 160)}`)
  check('普通用户账号注册成功', reg2.status === 200, `status=${reg2.status} ${reg2.text.slice(0, 160)}`)
  const adminLogin = await api('/api/auth/login', { method: 'POST', body: { username: 'e2eadmin', password: PASSWORD } })
  const admin = cookieFrom(adminLogin.res)
  const aliceLogin = await api('/api/auth/login', { method: 'POST', body: { username: 'alice', password: PASSWORD } })
  const alice = cookieFrom(aliceLogin.res)
  check('管理员登录拿到 Cookie', !!admin, `status=${adminLogin.status} ${adminLogin.text.slice(0, 160)}`)
  check('普通用户登录拿到 Cookie', !!alice, `status=${aliceLogin.status} ${aliceLogin.text.slice(0, 160)}`)

  /** 建一条通告（管理员 → 直接 approved） */
  async function createDeal(extra = {}) {
    const r = await api('/api/token-deals', {
      method: 'POST', cookie: admin,
      body: { provider: 'E2E', title: 'E2E 通告 ' + Math.random().toString(36).slice(2, 7), url: 'https://example.com/claim', ...extra },
    })
    if (r.status !== 200 || !r.json?.deal_id) throw new Error('建通告失败: ' + r.status + ' ' + r.text.slice(0, 200))
    return r.json.deal_id
  }
  async function setCodes(dealId, codes) {
    return api(`/api/token-deals/${dealId}/invite-codes`, { method: 'PUT', cookie: admin, body: { codes } })
  }

  // ═══ ① 占位符：抽中时替换 ═══
  console.log('\n▶ ① 领取地址 {邀请码} 占位符')
  const LY_TEMPLATE = 'https://platform.lyrouter.com/ai_gateway/workspace/login?action=register&referral_code={邀请码}&share_v=2'
  const D1 = await createDeal({ url: LY_TEMPLATE, real_name: 'id_card' })
  const CODE1 = 'LRT&CODE=1'
  const codesPut = await setCodes(D1, [{ code: CODE1, label: '专享', weight: 1, copyLimit: 0 }])
  check('码池写入成功', codesPut.status === 200, `status=${codesPut.status} ${codesPut.text.slice(0, 120)}`)

  const draw1 = await api(`/api/token-deals/${D1}/invite-code`)
  check('抽码 200', draw1.status === 200, `status=${draw1.status}`)
  checkEq('抽到的码就是池里那个', draw1.json?.data?.code, CODE1)
  checkEq('claim_url = 占位符已被替换且编码的完整地址',
    draw1.json?.data?.claim_url,
    'https://platform.lyrouter.com/ai_gateway/workspace/login?action=register&referral_code=LRT%26CODE%3D1&share_v=2')
  checkEq('claim_url_source = url（这条只有 url 写了占位符）', draw1.json?.data?.claim_url_source, 'url')
  check('claim_url 里没有残留占位符', !String(draw1.json?.data?.claim_url).includes('{')
    && !String(draw1.json?.data?.claim_url).includes('邀请码'))
  // 用标准 URL 解析器反解，证明地址结构没被码里的 & = 破坏
  checkEq('用 URLSearchParams 反解 referral_code 得到原始码（编码可逆、URL 未被打断）',
    new URL(draw1.json.data.claim_url).searchParams.get('referral_code'), CODE1)
  checkEq('share_v 参数未被码里的 & 打断', new URL(draw1.json.data.claim_url).searchParams.get('share_v'), '2')

  // ═══ ① 详情/列表：不出现任何码、不出现 claim_url ═══
  const d1 = await api(`/api/token-deals/${D1}`)
  check('详情 200', d1.status === 200, `status=${d1.status}`)
  const deal1 = d1.json?.deal || {}
  check('详情保留原文模板（编辑器要回填，剥掉就没法再编辑）',
    String(deal1.url || '').includes('{邀请码}'), JSON.stringify(deal1.url))
  checkEq('详情 claim_url_has_placeholder = true', deal1.claim_url_has_placeholder, true)
  checkEq('详情 claim_url_source = url', deal1.claim_url_source, 'url')
  // 硬不变量：详情里绝不能有 claim_url 字段（否则等于把替换搬进详情）
  check('详情不含 claim_url / claim_url_resolved 字段',
    !('claim_url' in deal1) && !('claim_url_resolved' in deal1), JSON.stringify(Object.keys(deal1).filter(k => k.includes('claim'))))
  check('详情不含 invite_codes（码池不随详情下发）', !('invite_codes' in deal1))
  check('详情原文搜不到任何码值（硬不变量）', !d1.text.includes(CODE1), '响应里出现了码明文')
  check('详情原文搜不到码的编码形态', !d1.text.includes(encodeURIComponent(CODE1)))
  const list1 = await api('/api/token-deals?limit=100')
  check('列表 200 且非空（后续断言的前提）', list1.status === 200 && (list1.json?.deals || []).length > 0,
    `status=${list1.status} n=${(list1.json?.deals || []).length}`)
  check('列表原文搜不到任何码值', !list1.text.includes(CODE1))
  check('列表不含 invite_codes 字段', (list1.json?.deals || []).every(x => !('invite_codes' in x)))

  // ═══ ① 模板有占位符但码池为空：claim_url 空串 + 无残留占位符 ═══
  const D2 = await createDeal({ url: 'https://example.com/reg?ref={邀请码}' })
  const draw2 = await api(`/api/token-deals/${D2}/invite-code`)
  check('无码池时抽码仍 200（结构稳定）', draw2.status === 200, `status=${draw2.status}`)
  checkEq('无码池时 code = null', draw2.json?.data?.code, null)
  checkEq('无码池时 claim_url = 空串（不是 null、不是半替换）', draw2.json?.data?.claim_url, '')
  check('无码池时响应里连占位符都不出现（无残留）',
    !draw2.text.includes('邀请码') && !draw2.text.includes('{code}')
    && !draw2.text.includes('{invite_code}') && !draw2.text.includes('｛'),
    draw2.text.slice(0, 200))
  const d2 = await api(`/api/token-deals/${D2}`)
  checkEq('无码池时详情仍如实告知「要抽码」（claim_url_has_placeholder=true）',
    d2.json?.deal?.claim_url_has_placeholder, true)

  // ═══ ① 占位符在 call_url 上 ═══
  const D3 = await createDeal({
    url: 'https://example.com/claim',
    call_url: 'https://api.example.com/v1?ref={invite_code}',
  })
  const CODE3 = 'C ODE/中'
  await setCodes(D3, [{ code: CODE3 }])
  const draw3 = await api(`/api/token-deals/${D3}/invite-code`)
  checkEq('占位符在 call_url 时 claim_url_source = call_url', draw3.json?.data?.claim_url_source, 'call_url')
  checkEq('call_url 上的占位符也被替换并编码',
    draw3.json?.data?.claim_url,
    'https://api.example.com/v1?ref=' + encodeURIComponent(CODE3))
  checkEq('反解 ref 得到原始码', new URL(draw3.json.data.claim_url).searchParams.get('ref'), CODE3)

  // ═══ ② 是否实名：四值写入-读出（Web 新建 + Web 编辑）═══
  console.log('\n▶ ② 是否实名字段')
  const REAL_CASES = [
    ['no', '', '否'],
    ['id_card', '', '身份证'],
    ['face', '', '人脸'],
    ['other', '需上传护照', '其他'],
  ]
  for (const [value, other, label] of REAL_CASES) {
    const id = await createDeal({ real_name: value, real_name_other: other })
    const row = dealRow(dbPath, id)
    checkEq(`新建 real_name='${value}'（${label}）落库正确`, [row.real_name, row.real_name_other], [value, other])
    const d = await api(`/api/token-deals/${id}`)
    checkEq(`新建 real_name='${value}' 详情读回一致`, [d.json?.deal?.real_name, d.json?.deal?.real_name_other], [value, other])
  }
  // 未填 = 空串（存量/默认），绝不为 null
  const D_EMPTY = await createDeal({})
  const emptyRow = dealRow(dbPath, D_EMPTY)
  checkEq('不填 real_name 时落库为空串（不是 NULL）', [emptyRow.real_name, emptyRow.real_name_other], ['', ''])

  // 清空规则：real_name 非 other 时 real_name_other 强制为空
  const D_CLEAR = await createDeal({ real_name: 'other', real_name_other: '需护照' })
  checkEq('先置为 other + 文案', dealRow(dbPath, D_CLEAR).real_name_other, '需护照')
  const clearPut = await api(`/api/token-deals/${D_CLEAR}`, {
    method: 'PUT', cookie: admin,
    body: {
      provider: 'E2E', title: 'E2E 清空规则', url: 'https://example.com/claim',
      real_name: 'no', real_name_other: '需护照',
    },
  })
  check('改成 no 的 PUT 成功', clearPut.status === 200, `status=${clearPut.status} ${clearPut.text.slice(0, 160)}`)
  checkEq('改成 no 后文案被强制清空（Web 通道）', [dealRow(dbPath, D_CLEAR).real_name, dealRow(dbPath, D_CLEAR).real_name_other], ['no', ''])

  // 非法值：Web 新建 / Web 编辑 / 建议通道 / AI patch（四条入口，同一份校验）
  const badCreate = await api('/api/token-deals', {
    method: 'POST', cookie: admin,
    body: { provider: 'E2E', title: '非法实名', url: 'https://example.com/x', real_name: 'passport' },
  })
  checkEq('Web 新建 real_name=passport → 400', badCreate.status, 400)
  check('400 文案提到是否实名',
    String(badCreate.json?.error || badCreate.json?.data?.error || '').includes('实名'), badCreate.text.slice(0, 160))
  const badPut = await api(`/api/token-deals/${D1}`, {
    method: 'PUT', cookie: admin,
    body: { provider: 'E2E', title: 'E2E 通告', url: LY_TEMPLATE, real_name: 'passport' },
  })
  checkEq('Web 编辑 real_name=passport → 400', badPut.status, 400)
  checkEq('被拒后库里的 real_name 未被改动', dealRow(dbPath, D1).real_name, 'id_card')

  // ═══ ② 建议通道：真实落库（不是"批准了但没写"）═══
  const propose = await api(`/api/token-deals/${D1}/edits`, {
    method: 'POST', cookie: alice, body: { real_name: 'face', comment: '这条其实要人脸' },
  })
  check('alice 提交「real_name → face」建议成功', propose.status === 200 && !!propose.json?.edit?.id,
    `status=${propose.status} ${propose.text.slice(0, 160)}`)
  const editId = propose.json?.edit?.id
  check('建议的 diff 里出现 real_name', (propose.json?.edit?.diff || []).some(x => x.field === 'real_name'),
    JSON.stringify(propose.json?.edit?.diff))
  const badPropose = await api(`/api/token-deals/${D1}/edits`, {
    method: 'POST', cookie: alice, body: { real_name: 'passport' },
  })
  checkEq('建议通道传非法值 → 400（无旁路）', badPropose.status, 400)
  const approve = await api(`/api/token-deal-edits/${editId}/review`, {
    method: 'POST', cookie: admin, body: { action: 'approve' },
  })
  check('管理员通过建议 200', approve.status === 200, `status=${approve.status} ${approve.text.slice(0, 160)}`)
  checkEq('建议批准后 real_name **真的**落库为 face', dealRow(dbPath, D1).real_name, 'face')
  // 顺带断言「清空规则」在这条通道同样生效：先置 other+文案，再建议改回 no
  await api(`/api/token-deals/${D1}`, {
    method: 'PUT', cookie: admin,
    body: {
      provider: 'E2E', title: 'E2E 通告', url: LY_TEMPLATE,
      real_name: 'other', real_name_other: '需护照',
    },
  })
  checkEq('前置：other + 文案已落库', [dealRow(dbPath, D1).real_name, dealRow(dbPath, D1).real_name_other], ['other', '需护照'])
  const propose2 = await api(`/api/token-deals/${D1}/edits`, {
    method: 'POST', cookie: alice, body: { real_name: 'no' },
  })
  const approve2 = await api(`/api/token-deal-edits/${propose2.json?.edit?.id}/review`, {
    method: 'POST', cookie: admin, body: { action: 'approve' },
  })
  check('第二条建议通过', approve2.status === 200, `status=${approve2.status}`)
  checkEq('建议通道改成 no 后文案同样被清空', [dealRow(dbPath, D1).real_name, dealRow(dbPath, D1).real_name_other], ['no', ''])

  // ═══ ② AI 通道：patch 落库 + changes 如实 + 非法被拒 ═══
  console.log('\n▶ ②-b AI 通道（real_name 与 category）')
  const pat = await api('/api/user/api-tokens', {
    method: 'POST', cookie: admin, body: { name: 'e2e-third', scopes: ['read', 'write'] },
  })
  const patToken = pat.json?.token || pat.json?.data?.token
  check('创建 AI 访问令牌（PAT）', !!patToken, `status=${pat.status} ${pat.text.slice(0, 160)}`)
  const ai = (path, opts = {}) => api(path, { ...opts, headers: { Authorization: `Bearer ${patToken}`, ...(opts.headers || {}) } })

  const aiPut = await ai(`/api/ai/token-deals/${D1}`, {
    method: 'PUT', body: { real_name: 'other', real_name_other: '需护照' },
  })
  check('AI patch real_name=other 成功', aiPut.status === 200, `status=${aiPut.status} ${aiPut.text.slice(0, 200)}`)
  checkEq('AI patch 的 changes 如实报告 real_name',
    aiPut.json?.changes?.real_name?.to, 'other')
  checkEq('AI patch 后两列都落库', [dealRow(dbPath, D1).real_name, dealRow(dbPath, D1).real_name_other], ['other', '需护照'])

  const aiPutClear = await ai('/api/ai/token-deals/' + D1, { method: 'PUT', body: { real_name: 'no' } })
  check('AI patch real_name=no 成功', aiPutClear.status === 200, `status=${aiPutClear.status}`)
  checkEq('AI 通道同样执行「非 other 清空文案」', [dealRow(dbPath, D1).real_name, dealRow(dbPath, D1).real_name_other], ['no', ''])

  const aiPutBad = await ai('/api/ai/token-deals/' + D1, { method: 'PUT', body: { real_name: 'passport' } })
  checkEq('AI patch 非法值 → 400（无旁路）', aiPutBad.status, 400)
  checkEq('AI 通道被拒后库里仍是 no', dealRow(dbPath, D1).real_name, 'no')

  // 顺手修的既有缺陷：category 走 AI 通道原本被静默丢弃
  const aiPutCat = await ai('/api/ai/token-deals/' + D1, { method: 'PUT', body: { category: 'cloud' } })
  check('AI patch category → 200', aiPutCat.status === 200, `status=${aiPutCat.status}`)
  checkEq('changes 里出现 category（原先接口回「已保存」但 changes 里没有）',
    aiPutCat.json?.changes?.category, { from: 'token', to: 'cloud' })
  checkEq('category 真的落库（原先静默丢弃）', dealRow(dbPath, D1).category, 'cloud')
  const aiPutBadCat = await ai('/api/ai/token-deals/' + D1, { method: 'PUT', body: { category: 'vps' } })
  checkEq('AI patch 非法 category → 400（校验未旁路）', aiPutBadCat.status, 400)

  const aiCreate = await ai('/api/ai/token-deals', {
    method: 'POST',
    body: { provider: 'AI 建', title: 'AI 新建探针', url: 'https://example.com/ai', category: 'client', real_name: 'face' },
  })
  check('AI 新建通告 200', aiCreate.status === 200, `status=${aiCreate.status} ${aiCreate.text.slice(0, 200)}`)
  const aiDealId = aiCreate.json?.token_deal?.id
  check('AI 新建返回通告 id', !!aiDealId)
  if (aiDealId) {
    const row = dealRow(dbPath, aiDealId)
    checkEq('AI 新建时 category 落库（原先 INSERT 漏了该列，恒落 token）', row.category, 'client')
    checkEq('AI 新建时 real_name 落库', row.real_name, 'face')
  }

  // ═══ ④ AI 文档 + 内部字段不回归 ═══
  const describe = await ai('/api/ai/describe')
  check('describe 200', describe.status === 200, `status=${describe.status}`)
  const tdFields = describe.json?.resources?.token_deals?.fields || {}
  check('describe 的字段字典非空（后续断言前提）', Object.keys(tdFields).length > 5, `字段数 ${Object.keys(tdFields).length}`)
  check('describe 收录 real_name / real_name_other', 'real_name' in tdFields && 'real_name_other' in tdFields,
    JSON.stringify(Object.keys(tdFields)))
  check('describe 未把内部字段写进字段字典',
    !('verified_by' in tdFields) && !('guest_fingerprint' in tdFields) && !('deleted_by' in tdFields),
    JSON.stringify(Object.keys(tdFields)))
  check('describe 的说明里写明了占位符与 claim_url',
    String(describe.json?.resources?.token_deals?.note || '').includes('{邀请码}')
    && String(describe.json?.resources?.token_deals?.note || '').includes('claim_url'))
  const aiList = await ai('/api/ai/token-deals?limit=50')
  const aiDeals = aiList.json?.token_deals || []
  check('AI 列表非空（后续断言前提）', aiDeals.length > 0, `n=${aiDeals.length}`)
  check('AI 列表不下发内部字段',
    aiDeals.length > 0 && aiDeals.every(x => !('verified_by' in x) && !('guest_fingerprint' in x) && !('deleted_by' in x)),
    JSON.stringify(Object.keys(aiDeals[0] || {})))
  check('AI 列表下发 real_name（公开字段，应当可读）',
    aiDeals.length > 0 && aiDeals.every(x => 'real_name' in x))

  // ═══ ② 编辑不该造出假差异（dealToPatchShape 必须摊平新字段）═══
  //
  // 症状（task-4 观察项 / Lead 追加 3）：`DEAL_PATCHABLE` 有了 real_name，但
  // `dealToPatchShape()` 没摊平它 → `diffDealPatch` 拿"库里有 no、patch 里 undefined"当差异，
  // 于是模板一个字没改也会发一条 `updated` 事件（订阅方噪音 + 语义错误）。
  // 断言方式：把库里现值的全部字段原样 PUT 回去，`updated` 事件不得增加。
  {
    const D_QUIET = await createDeal({ real_name: 'face' })
    const countUpdated = (id) => Number(scalar(
      dbPath, "SELECT COUNT(*) FROM token_deal_events WHERE deal_id = ? AND kind = 'updated'", id,
    ) ?? 0)
    const before = countUpdated(D_QUIET)
    const row = withDb(dbPath, db => db.prepare('SELECT * FROM token_deals WHERE id = ?').get(D_QUIET))
    const samePut = await api(`/api/token-deals/${D_QUIET}`, {
      method: 'PUT', cookie: admin,
      body: {
        provider: row.provider, title: row.title, url: row.url, call_url: row.call_url,
        quota: row.quota, models: JSON.parse(row.models || '[]'), region: row.region,
        quality: row.quality, source_tag: row.source_tag, category: row.category,
        expires_at: row.expires_at, note: row.note,
        real_name: row.real_name, real_name_other: row.real_name_other,
      },
    })
    check('原样 PUT 成功（含 real_name 原值）', samePut.status === 200, `status=${samePut.status}`)
    const after = countUpdated(D_QUIET)
    checkEq('原样 PUT 不产生 updated 事件（real_name / category 都已进 patch 形状，无假差异）',
      [before, after], [0, 0])
    checkEq('原样 PUT 后 real_name 未被改动', dealRow(dbPath, D_QUIET).real_name, 'face')
  }

  // ═══ ④ 通知入参形状（Lead 追加 2）═══
  //
  // 原先 index.post.ts 把**提交载荷**（camelCase、无 id）传给 notifyTokenDealPublished，
  // 于是「新通告发布」这条通知永远拼不出详情链接。改成库行后必须能拼出 `/tokens/<id>.html`；
  // 同时这也是最容易泄露内部列的地方（库行含 verified_by / guest_fingerprint / deleted_by），
  // 故额外造一条"毒化"待审通告走审核通道，断言正文零命中。
  console.log('\n▶ ④ 通知入参形状（库行 → 详情链接 + 不泄露内部列）')
  {
    const SPOOL = join(WORK, 'qq-outbox')
    const cfg = await api('/api/admin/config', {
      method: 'PUT', cookie: admin,
      body: {
        data: {
          qq_bot_enabled: 'true',
          qq_bot_transport: 'outbox',
          qq_outbox_path: SPOOL,
          qq_bot_group_id: 'e2e-group',
          qq_admin_qq: '',
        },
      },
    })
    check('切换 QQ 通知为 outbox 传输（落 /tmp，不触外网）', cfg.status === 200, `${cfg.status} ${cfg.text.slice(0, 160)}`)

    const base = spoolEntries(SPOOL).length
    const NP = await createDeal({ title: '通知形状探针' })
    await waitSpool(SPOOL, base + 1, '新通告发布')
    const pubCards = spoolEntries(SPOOL).slice(base)
    const pubText = pubCards.map(c => JSON.stringify(c.entry)).join('\n')
    check('收到「新通告发布」通知', /新通告发布/.test(pubText), JSON.stringify(pubCards.map(c => c.file)))
    check('新通告发布通知含详情链接 /tokens/<id>.html（原先传提交载荷时永远拼不出）',
      pubText.includes(`/tokens/${NP}.html`), pubText.slice(0, 300))

    // 毒化探针：内部列全部填上可辨识的值，走「审核通过」通道（同一 notify 层）
    withDb(dbPath, (db) => {
      const now = Date.now()
      db.prepare(`
        INSERT INTO token_deals (id, user_id, guest_name, guest_fingerprint, verified_by, deleted_by,
          provider, title, url, models, region, quality, source_tag, category, status, note,
          real_name, real_name_other, pinned, created_at, updated_at)
        VALUES ('e2e_notify_poison', 1, '游客毒', 'fp:secret-probe', '内部核验人', 1,
          '毒化服务商', '毒化探针通告', 'https://example.com/poison', '[]', 'cn', '中品',
          'official', 'token', 'pending', 'x', 'face', '', 0, ?, ?)
      `).run(now, now)
    })
    const base2 = spoolEntries(SPOOL).length
    const appr = await api('/api/admin/token-deals/e2e_notify_poison/review', {
      method: 'POST', cookie: admin, body: { action: 'approve' },
    })
    check('审核通过毒化探针 200', appr.status === 200, `${appr.status} ${appr.text.slice(0, 160)}`)
    await waitSpool(SPOOL, base2 + 1, '审核通过通知')
    const apprText = spoolEntries(SPOOL).slice(base2).map(c => JSON.stringify(c.entry)).join('\n')
    check('审核通知送达', apprText.includes('毒化探针通告'), apprText.slice(0, 200))
    check('审核通知含详情链接', apprText.includes('/tokens/e2e_notify_poison.html'), apprText.slice(0, 300))
    check('审核通知不含内部字段值（游客指纹 / 核验人）',
      !apprText.includes('fp:secret-probe') && !apprText.includes('内部核验人'), apprText.slice(0, 400))
    const allText = spoolEntries(SPOOL).map(c => JSON.stringify(c.entry)).join('\n')
    check('全部通知正文零命中内部字段值（全量兜底）',
      !allText.includes('fp:secret-probe') && !allText.includes('内部核验人'))
    check('全部通知正文零命中内部字段名（verified_by / guest_fingerprint / deleted_by）',
      !/verified_by|guest_fingerprint|deleted_by/.test(allText))
  }

  // ═══ ③ 默认排序 = 最新 ═══
  console.log('\n▶ ③ /tokens 默认排序')
  {
    // 用三条时间戳明确、且互不相同的探针行（HTTP 新建的 created_at 可能同毫秒，排序不确定）
    const now = Date.now()
    const probes = [
      ['e2e_sort_old', now - 900_000],
      ['e2e_sort_mid', now - 600_000],
      ['e2e_sort_new', now - 300_000],
    ]
    withDb(dbPath, (db) => {
      const ins = db.prepare(`
        INSERT INTO token_deals (id, user_id, provider, title, url, models, region, quality,
          source_tag, category, status, note, pinned, created_at, updated_at)
        VALUES (?, 0, 'E2E排序', ?, 'https://example.com/sort', '[]', 'cn', '中品',
          'official', 'token', 'approved', 'x', 0, ?, ?)
      `)
      for (const [id, ts] of probes) ins.run(id, '排序探针 ' + id, ts, ts)
    })
    const listDefault = await api('/api/token-deals?limit=100')
    const rows = listDefault.json?.deals || []
    const idx = (id) => rows.findIndex(r => r.id === id)
    check('三条排序探针都在默认列表里（前提）',
      idx('e2e_sort_old') >= 0 && idx('e2e_sort_mid') >= 0 && idx('e2e_sort_new') >= 0,
      `old=${idx('e2e_sort_old')} mid=${idx('e2e_sort_mid')} new=${idx('e2e_sort_new')}`)
    check('默认排序：最新的探针排在最前（old → mid → new 的下标递增）',
      idx('e2e_sort_new') < idx('e2e_sort_mid') && idx('e2e_sort_mid') < idx('e2e_sort_old'),
      `new=${idx('e2e_sort_new')} mid=${idx('e2e_sort_mid')} old=${idx('e2e_sort_old')}`)
    // 置顶恒在最前：钉一条 pinned=1，确认它压过最新
    // 置顶恒在最前：把最早那条钉住，确认它越过了两条更新的探针。
    // 注意别断言"它排第 0"——种子数据里本来就有 2 条 pinned 通告，
    // 正确判据是「pinned 分块在前 + 本行越过更新的非置顶行」。
    withDb(dbPath, (db) => db.prepare('UPDATE token_deals SET pinned = 1 WHERE id = ?').run('e2e_sort_old'))
    const listPinned = await api('/api/token-deals?limit=100')
    const pIdx = (listPinned.json?.deals || []).findIndex(d => d.id === 'e2e_sort_old')
    const pNew = (listPinned.json?.deals || []).findIndex(d => d.id === 'e2e_sort_new')
    check('置顶后 e2e_sort_old 越过更新的 e2e_sort_new（pinned 语义仍生效）',
      pIdx >= 0 && pNew >= 0 && pIdx < pNew, `pinned@${pIdx} new@${pNew}`)
    check('置顶行之前的所有行也都是置顶行（pinned 分块在前）',
      pIdx >= 0 && (listPinned.json?.deals || []).slice(0, pIdx).every(d => !!d.pinned),
      JSON.stringify((listPinned.json?.deals || []).slice(0, pIdx).map(d => [d.id, d.pinned])))
    // 取消置顶 → 回到"按最新"
    withDb(dbPath, (db) => db.prepare('UPDATE token_deals SET pinned = 0 WHERE id = ?').run('e2e_sort_old'))
    const listUnpinned = await api('/api/token-deals?limit=100')
    const uOld = (listUnpinned.json?.deals || []).findIndex(d => d.id === 'e2e_sort_old')
    const uNew = (listUnpinned.json?.deals || []).findIndex(d => d.id === 'e2e_sort_new')
    check('取消置顶后回到按最新排序（e2e_sort_old 又落到 e2e_sort_new 之后）',
      uOld > uNew && uNew >= 0, `old@${uOld} new@${uNew}`)
    // 非置顶行整体按 created_at 倒序
    const sortedRows = (listDefault.json?.deals || []).filter(d => !d.pinned)
    const isDesc = sortedRows.every((d, i) => i === 0 || (sortedRows[i - 1].created_at >= d.created_at))
    check('默认列表的非置顶行整体按 created_at 倒序', sortedRows.length > 1 && isDesc, `n=${sortedRows.length}`)
    // 显式 sort=nexus 仍可用
    const nexusR = await api('/api/token-deals?limit=100&sort=nexus')
    check('显式 sort=nexus 仍 200 且包含全部探针',
      nexusR.status === 200 && ['e2e_sort_old', 'e2e_sort_mid', 'e2e_sort_new']
        .every(id => (nexusR.json?.deals || []).some(d => d.id === id)), `status=${nexusR.status}`)
  }

  // ═══ ② 游客通道（模块级：HTTP 层被 Turnstile fail-closed 挡住，见文件头"诚实的边界"）═══
  console.log('\n▶ ②-c 游客发布通道（模块级，真实 INSERT + 真实校验）')
  await guestModuleSuite(dbPath)
  return { D1 }
}

/**
 * 游客写路径的模块级测试。
 *
 * 复制真实 `guest-deals.ts` + `token-deals.ts` 到临时目录，**只替换防滥用层**
 * （human-check / spam / guest-reviews 身份 / 以及 token-deals 里用不到的
 *  deal-events / config / database / qq-notify），INSERT 与字段校验都是真实源码。
 * 这样既能证明"游客选的 real_name 真的落库"，又不改动任何防滥用逻辑。
 */
async function guestModuleSuite(dbPath) {
  const dir = mkdtempSync(join(tmpdir(), 'guestdeal-'))
  const write = (name, content) => writeFileSync(join(dir, name), content)
  // 桩：只做"放行"，不改变被测逻辑
  write('stub-human-check.ts', 'export async function assertHumanCheck() { return null }\n')
  write('stub-spam.ts', 'export function hasSpamText() { return false }\n')
  write('stub-guest-reviews.ts',
    'export const GUEST_LIMITS = { nickname: 40 }\n'
    // 每次调用返回不同的身份：真实逻辑按 ip_hash 做每日上限、按指纹做待审上限，
    // 恒返回同一个身份会在第 2 条起被 429 挡住，测不到 INSERT
    + 'let seq = 0\n'
    + "export function guestIdentity() { seq += 1; return { ipHash: 'stub-ip-' + seq, fingerprint: 'stub-fp-' + seq } }\n")
  write('stub-deal-events.ts', 'export function appendDealEvent() {}\nexport function deleteDealEvents() {}\n')
  write('stub-config.ts', 'export function getConfigInt(_k: string, d: number) { return d }\n')
  write('stub-database.ts', 'export function getRawDb(): any { throw new Error("not used in unit test") }\n')
  write('stub-qq-notify.ts',
    'export function notifyTokenDealApproved() {}\nexport function notifyTokenDealRejected() {}\n')

  const rewrite = (src, pairs) => {
    let code = src
    for (const [from, to] of pairs) {
      if (!code.includes(from)) throw new Error(`导入改写失败（源码可能已变动）：${from}`)
      code = code.replaceAll(from, to)
    }
    return code
  }

  write('token-deals.ts', rewrite(
    readFileSync(join(ROOT, 'server', 'utils', 'token-deals.ts'), 'utf8'),
    [
      ["from './deal-events'", "from './stub-deal-events.ts'"],
      ["from './config'", "from './stub-config.ts'"],
      ["from '../database'", "from './stub-database.ts'"],
      ["from './qq-notify'", "from './stub-qq-notify.ts'"],
    ],
  ))
  write('guest-deals.ts', rewrite(
    readFileSync(join(ROOT, 'server', 'utils', 'guest-deals.ts'), 'utf8'),
    [
      ["from './guest-reviews'", "from './stub-guest-reviews.ts'"],
      ["from './human-check'", "from './stub-human-check.ts'"],
      ["from './spam'", "from './stub-spam.ts'"],
      ["from './token-deals'", "from './token-deals.ts'"],
    ],
  ))

  const mod = await import(pathToFileURL(join(dir, 'guest-deals.ts')).href)
  check('游客发布模块已加载（真实 INSERT 路径）', typeof mod.submitGuestDeal === 'function')

  const Database = requireFromRoot('better-sqlite3')
  const db = new Database(dbPath)
  try {
    // 1) 正常写入：real_name='face' 必须真的落库
    const r1 = await mod.submitGuestDeal(db, { headers: {} }, {
      provider: '游客小明', title: '游客实名探针', url: 'https://example.com/guest-face',
      nickname: '小明', real_name: 'face',
    })
    check('游客提交成功（face）', r1.ok === true, JSON.stringify(r1))
    const row1 = r1.ok ? dealRow(dbPath, r1.data.dealId) : null
    checkEq('游客选的 real_name=face **真的**落库（不是空串）', row1?.real_name, 'face')

    // 2) 「其他」+ 文案
    const r2 = await mod.submitGuestDeal(db, { headers: {} }, {
      provider: '游客小红', title: '游客实名探针 2', url: 'https://example.com/guest-other',
      nickname: '小红', real_name: 'other', real_name_other: '需护照',
    })
    const row2 = r2.ok ? dealRow(dbPath, r2.data.dealId) : null
    checkEq('游客 other + 文案落库', [row2?.real_name, row2?.real_name_other], ['other', '需护照'])
    if (!r2.ok) console.log('  [debug] 第 2 条游客提交失败：', JSON.stringify(r2))

    // 3) 清空规则在这条通道同样生效
    const r3 = await mod.submitGuestDeal(db, { headers: {} }, {
      provider: '游客小刚', title: '游客实名探针 3', url: 'https://example.com/guest-no',
      nickname: '小刚', real_name: 'no', real_name_other: '不该留下',
    })
    const row3 = r3.ok ? dealRow(dbPath, r3.data.dealId) : null
    checkEq('游客选 no 时文案被清空（同一份规则）', [row3?.real_name, row3?.real_name_other], ['no', ''])

    // 4) 非法值被拒（同一个校验函数）
    const r4 = await mod.submitGuestDeal(db, { headers: {} }, {
      provider: '游客非法', title: '游客非法探针', url: 'https://example.com/guest-bad',
      nickname: '非法', real_name: 'passport',
    })
    check('游客通道传非法 real_name → ok:false / 400',
      r4.ok === false && r4.status === 400, JSON.stringify(r4))

    // 5) 游客也能标 category（原先 INSERT 漏了该列，恒落 token）
    const r5 = await mod.submitGuestDeal(db, { headers: {} }, {
      provider: '游客分类', title: '游客分类探针', url: 'https://example.com/guest-cat',
      nickname: '分类', category: 'cloud',
    })
    const row5 = r5.ok ? dealRow(dbPath, r5.data.dealId) : null
    checkEq('游客选的 category 落库（原先静默丢弃）', row5?.category, 'cloud')
  } finally {
    db.close()
  }
}

// ════════════════════════════════════════════════════════════
// 2. 迁移：在「已有数据的旧库」上跑（不是空库）
// ════════════════════════════════════════════════════════════
async function migrationSuite() {
  console.log('\n▶ ②-d 迁移：已有 80 条存量数据的旧库')
  const dbPath = join(WORK, 'old-with-data.db')

  // 先让应用把库建好（含种子），再"退回旧版结构"：把新列 DROP 掉
  const logs0 = await startApp(dbPath)
  await stopApp()
  check('首次启动完成建库', existsSync(dbPath))
  withDb(dbPath, (db) => {
    const cols = db.prepare('PRAGMA table_xinfo(token_deals)').all().map(c => c.name)
    check('新建库后 real_name / real_name_other 列存在（ensureColumn 生效）',
      cols.includes('real_name') && cols.includes('real_name_other'), JSON.stringify(cols.filter(c => c.startsWith('real_name'))))
    // 退回旧库结构 —— SQLite 3.35+ 支持 DROP COLUMN，这里用它造"老库"
    db.exec('ALTER TABLE token_deals DROP COLUMN real_name')
    db.exec('ALTER TABLE token_deals DROP COLUMN real_name_other')
    const after = db.prepare('PRAGMA table_xinfo(token_deals)').all().map(c => c.name)
    check('已退回旧库结构（新列不存在）', !after.includes('real_name') && !after.includes('real_name_other'))

    // 造 80 条"存量数据"（与生产库规模一致），字段值可辨识，便于验证"零丢失"
    db.prepare('DELETE FROM token_deals').run()
    const ins = db.prepare(`
      INSERT INTO token_deals (id, user_id, provider, title, url, models, region, quality,
        source_tag, category, status, note, pinned, created_at, updated_at)
      VALUES (?, 0, ?, ?, ?, ?, 'cn', '中品', 'official', ?, 'approved', ?, 0, ?, ?)
    `)
    const t0 = Date.now() - 80 * 60_000
    for (let i = 1; i <= 80; i++) {
      ins.run(
        'legacy_deal_' + String(i).padStart(3, '0'),
        '存量服务商 ' + i,
        '存量通告 ' + i,
        `https://legacy.example.com/claim/${i}`,
        '[]',
        i % 3 === 0 ? 'cloud' : 'token',
        '存量备注 ' + i,
        t0 + i * 60_000,
        t0 + i * 60_000,
      )
    }
  })
  const before = withDb(dbPath, (db) => db.prepare(
    'SELECT COUNT(*) AS n, SUM(LENGTH(title)) AS t, SUM(LENGTH(url)) AS u, MAX(created_at) AS c FROM token_deals'
  ).get())
  checkEq('迁移前存量数据 = 80 条', before.n, 80)

  // 关键一步：在有 80 条数据的旧库上启动 → 迁移必须自己补列且不丢数据
  const logs1 = await startApp(dbPath)
  const logText1 = logs1.join('')
  check('迁移日志明确打印「添加 real_name 字段」', /token_deals 表添加 real_name 字段/.test(logText1),
    logText1.slice(-400))
  check('迁移日志明确打印「添加 real_name_other 字段」', /token_deals 表添加 real_name_other 字段/.test(logText1),
    logText1.slice(-400))
  const afterMigrate = withDb(dbPath, (db) => db.prepare(
    'SELECT COUNT(*) AS n, SUM(LENGTH(title)) AS t, SUM(LENGTH(url)) AS u, MAX(created_at) AS c FROM token_deals'
  ).get())
  checkEq('迁移后条数仍是 80（零丢失）', afterMigrate.n, 80)
  checkEq('迁移后既有字段值未变（title/url 长度与最大 created_at 一致）',
    [afterMigrate.t, afterMigrate.u, afterMigrate.c], [before.t, before.u, before.c])
  const nullCount = withDb(dbPath, (db) => db.prepare(
    'SELECT COUNT(*) AS c FROM token_deals WHERE real_name IS NULL OR real_name_other IS NULL'
  ).get().c)
  checkEq('存量行没有 NULL（前端不会拿到 null）', nullCount, 0)
  const types = withDb(dbPath, (db) => db.prepare(
    "SELECT DISTINCT typeof(real_name) AS t, real_name AS v FROM token_deals"
  ).all())
  check('存量行的 real_name 全是 text 且值为空串',
    types.length === 1 && types[0].t === 'text' && types[0].v === '', JSON.stringify(types))
  const integrity = withDb(dbPath, (db) => db.prepare('PRAGMA integrity_check').get())
  checkEq('PRAGMA integrity_check = ok', Object.values(integrity)[0], 'ok')

  // 存量条目经 HTTP 读得出来（前端不崩）
  const legacyDetail = await api('/api/token-deals/legacy_deal_010')
  check('存量通告详情 200', legacyDetail.status === 200, `status=${legacyDetail.status}`)
  checkEq('存量通告 real_name 读作空串（未标注）', legacyDetail.json?.deal?.real_name, '')
  checkEq('存量通告 claim_url_has_placeholder = false', legacyDetail.json?.deal?.claim_url_has_placeholder, false)
  const legacyList = await api('/api/token-deals?limit=100')
  check('存量列表 200 且条数正常', legacyList.status === 200 && (legacyList.json?.deals || []).length === 80,
    `n=${(legacyList.json?.deals || []).length}`)

  // 再启动一次：必须幂等（不再加列、数据不变）
  // 注意：必须先 stopApp —— 否则新进程会 EADDRINUSE 直接死掉，
  // 而 /api/announcements 探测被**上一个进程**应答，于是"二启成功"是假的（踩过）。
  await stopApp()
  const logs2 = await startApp(dbPath)
  const logText2 = logs2.join('')
  check('二次启动不再添加 real_name 列（幂等）', !/表添加 real_name 字段/.test(logText2), logText2.slice(-300))
  const afterSecond = withDb(dbPath, (db) => db.prepare(
    'SELECT COUNT(*) AS n, SUM(LENGTH(title)) AS t FROM token_deals'
  ).get())
  checkEq('二次启动后数据无变化', [afterSecond.n, afterSecond.t], [afterMigrate.n, afterMigrate.t])
  await stopApp()
}

// ════════════════════════════════════════════════════════════
// 3. 生产一致性快照迁移（真实旧库，不是造出来的空库）
//
// 这份快照是 Lead 用 `sqlite3 .backup` 从生产库导出的：
//   80 条通告 / 208 条游客评测 / 3 个用户 / 1 条公告，
//   且 **real_name 两列与游客评测软删除三列都不存在** —— 正好是本次迁移要面对的形态。
// 只用副本，绝不写 /tmp/prodcopy.db 本身（那是唯一基线）。
// ════════════════════════════════════════════════════════════
const PROD_SNAPSHOT = '/tmp/prodcopy.db'
const SKILL_GUIDE_TITLE = '📬 装个技能包，让 AI 助手替你盯白嫖通告'
/** 源文件 /tmp/announcement-skill-guide.md 的字节数（见生成命令的输出） */
const SKILL_GUIDE_BYTES = 1889
/** 同一份正文的 JS `.length`（UTF-16 码元数；📬 占 2 → 比 wc -m 的字符数多 1） */
const SKILL_GUIDE_UNITS = 877

async function productionCopySuite() {
  console.log('\n▶ ⑤ 生产一致性快照迁移（真实旧库：80 通告 / 208 游客评测 / 3 用户）')
  if (!existsSync(PROD_SNAPSHOT)) {
    console.log(`  ⚠ 跳过：未找到 ${PROD_SNAPSHOT}（生产快照）。需要该文件才能验证"真实旧库迁移"。`)
    skipped.push(`生产快照迁移（${PROD_SNAPSHOT} 不存在）`)
    return
  }
  const dbPath = join(WORK, 'mig-test.db')
  copyFileSync(PROD_SNAPSHOT, dbPath) // 只动副本

  const snap = () => withDb(dbPath, (db) => ({
    deals: db.prepare('SELECT COUNT(*) AS c FROM token_deals').get().c,
    reviews: db.prepare('SELECT COUNT(*) AS c FROM token_deal_guest_reviews').get().c,
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    announcements: db.prepare('SELECT COUNT(*) AS c FROM announcements').get().c,
    dealCols: db.prepare('PRAGMA table_xinfo(token_deals)').all().map(c => c.name),
    reviewCols: db.prepare('PRAGMA table_xinfo(token_deal_guest_reviews)').all().map(c => c.name),
    auditTable: !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='guest_review_admin_actions'").get(),
    integrity: Object.values(db.prepare('PRAGMA integrity_check').get())[0],
    dealSize: db.prepare('SELECT SUM(LENGTH(title) + LENGTH(url)) AS s FROM token_deals').get().s,
    reviewSize: db.prepare('SELECT SUM(LENGTH(content)) AS s FROM token_deal_guest_reviews').get().s,
  }))

  // ── 先钉基线：快照被谁改过就该立刻发现，而不是让断言在错的基线上"通过" ──
  const before = snap()
  checkEq('快照基线：80 条通告 / 208 条游客评测 / 3 个用户', [before.deals, before.reviews, before.users], [80, 208, 3])
  check('快照基线：是真正的旧库（没有 real_name / real_name_other）',
    !before.dealCols.includes('real_name') && !before.dealCols.includes('real_name_other'))
  check('快照基线：游客评测还没有软删除三列',
    !before.reviewCols.includes('deleted_at') && !before.reviewCols.includes('deleted_by')
    && !before.reviewCols.includes('deleted_status'))
  check('快照基线：还没有 guest_review_admin_actions 表', !before.auditTable)
  checkEq('快照基线 integrity_check = ok', before.integrity, 'ok')
  check('快照基线：公告表本来就有内容（所以"表空才插"的旧种子永远不触发）',
    before.announcements >= 1, `announcements=${before.announcements}`)

  // ── 第一次启动：跑迁移 ──
  const logs1 = await startApp(dbPath)
  const log1 = logs1.join('')
  check('迁移日志：token_deals 添加 real_name 字段', /token_deals 表添加 real_name 字段/.test(log1), log1.slice(-500))
  check('迁移日志：token_deals 添加 real_name_other 字段', /token_deals 表添加 real_name_other 字段/.test(log1))
  check('迁移日志：游客评测添加 deleted_at / deleted_by / deleted_status 三列',
    /token_deal_guest_reviews 表添加 deleted_at 字段/.test(log1)
    && /token_deal_guest_reviews 表添加 deleted_by 字段/.test(log1)
    && /token_deal_guest_reviews 表添加 deleted_status 字段/.test(log1), log1.slice(-600))
  check('迁移日志：技能包引导公告已灌入', /已灌入技能包引导公告/.test(log1), log1.slice(-400))

  const after1 = snap()
  checkEq('迁移后：通告 80 / 游客评测 208 / 用户 3 —— 一条不丢',
    [after1.deals, after1.reviews, after1.users], [before.deals, before.reviews, before.users])
  checkEq('迁移后：既有内容未变（title+url / 评测正文总长度一致）',
    [after1.dealSize, after1.reviewSize], [before.dealSize, before.reviewSize])
  check('迁移后：real_name / real_name_other 两列已存在',
    after1.dealCols.includes('real_name') && after1.dealCols.includes('real_name_other'))
  check('迁移后：游客评测软删除三列已存在',
    after1.reviewCols.includes('deleted_at') && after1.reviewCols.includes('deleted_by')
    && after1.reviewCols.includes('deleted_status'))
  check('迁移后：guest_review_admin_actions 表已建', after1.auditTable)
  checkEq('迁移后 integrity_check 仍 ok', after1.integrity, 'ok')

  // 存量 80 条的 real_name 必须全是空串（不是 NULL）—— 前端按"空串不渲染徽标"约定实现，
  // 出现 NULL 会让 80 条老数据在页面上冒出异常
  const stat = withDb(dbPath, (db) => db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN real_name = '' THEN 1 ELSE 0 END) AS empty_n,
      SUM(CASE WHEN real_name IS NULL THEN 1 ELSE 0 END) AS null_n,
      SUM(CASE WHEN real_name_other = '' THEN 1 ELSE 0 END) AS empty_o,
      SUM(CASE WHEN real_name_other IS NULL THEN 1 ELSE 0 END) AS null_o,
      SUM(CASE WHEN typeof(real_name) = 'text' THEN 1 ELSE 0 END) AS text_n
    FROM token_deals
  `).get())
  checkEq('存量 80 条 real_name 全为空串、零 NULL、全为 text',
    [stat.total, stat.empty_n, stat.null_n, stat.text_n], [80, 80, 0, 80])
  checkEq('存量 80 条 real_name_other 全为空串、零 NULL', [stat.empty_o, stat.null_o], [80, 0])

  // ── 技能包引导公告：字段 / 长度 / 关键内容 ──
  const ann = withDb(dbPath, (db) => db.prepare(
    'SELECT title, content, content_type, status, pinned FROM announcements WHERE title = ?'
  ).get(SKILL_GUIDE_TITLE))
  check('引导公告存在且标题逐字一致（标题即幂等键）', !!ann)
  if (ann) {
    checkEq('引导公告字段：published + 置顶 + markdown',
      [ann.status, Number(ann.pinned), ann.content_type], ['published', 1, 'markdown'])
    const body = String(ann.content)
    checkEq(`引导公告正文 JS 长度 = ${SKILL_GUIDE_UNITS}（换行/反引号未丢）`, body.length, SKILL_GUIDE_UNITS)
    checkEq(`引导公告正文 UTF-8 字节数 = ${SKILL_GUIDE_BYTES}`, Buffer.byteLength(body, 'utf8'), SKILL_GUIDE_BYTES)
    check('正文含 /skills/favshub-data-ops.json', body.includes('/skills/favshub-data-ops.json'))
    check('正文含 ```bash 代码块围栏（没被转义弄坏）', body.includes('```bash') && body.includes('```'))
    check('正文含 Markdown 表格分隔行', /\|\s*-{3,}/.test(body))
  }
  checkEq('公告总数：1 → 2（旧种子不动，新公告追加）', after1.announcements, before.announcements + 1)

  // ── 迁移后真实端点可用（追加 1 要消灭的就是这个 500）──
  //
  // 生产快照的用户是 _system / admin_favs / huanyu，注册通道在生产是关闭的
  // （allow_registration='false'），所以这里**不注册新账号**（那会改用户数、破坏"3 用户不变"断言），
  // 改为把既有管理员 admin_favs 的密码在**副本上**改成测试口令 —— 只动副本，不动 /tmp/prodcopy.db。
  setTestPasswordOnCopy(dbPath, 'admin_favs', PASSWORD)
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin_favs', password: PASSWORD } })
  const adminCookie = cookieFrom(login.res)
  check('以既有管理员 admin_favs 登录成功（登录通道在真实旧库上可用）',
    login.status === 200 && !!adminCookie, `status=${login.status} ${login.text.slice(0, 160)}`)
  const queue = await api('/api/admin/guest-reviews?limit=5', { cookie: adminCookie })
  check('迁移后 GET /api/admin/guest-reviews = 200（旧库上不再 500 no such column）',
    queue.status === 200, `status=${queue.status} ${queue.text.slice(0, 200)}`)
  check('待审队列读得出真实存量数据', Number(queue.json?.total) > 0, `total=${queue.json?.total}`)
  const auditReviewId = String(withDb(dbPath, db => db.prepare(
    'SELECT id FROM token_deal_guest_reviews ORDER BY created_at DESC LIMIT 1'
  ).get()?.id ?? ''))
  check('取到一条存量评测 id（审计端点必填参数）', !!auditReviewId)
  const audit = await api(`/api/admin/guest-reviews/audit?id=${encodeURIComponent(auditReviewId)}`, { cookie: adminCookie })
  check('迁移后 GET /api/admin/guest-reviews/audit = 200（审计表已建、存量评测可查）',
    audit.status === 200, `status=${audit.status} ${audit.text.slice(0, 200)}`)
  check('审计响应结构正确（review_id 对得上、actions 是数组）',
    audit.json?.review_id === auditReviewId && Array.isArray(audit.json?.actions),
    JSON.stringify(audit.json).slice(0, 200))
  const legacy = await api('/api/token-deals?limit=100')
  // 注意：快照里有 80 条，但**公开可见的只有 63 条**（其余是 pending / 已失效 / 已过期 / 已删除）。
  // 这里断言的是「公开列表口径没被迁移改坏」，不是「80 条全都看得见」。
  const publicVisible = Number(scalar(
    dbPath, 'SELECT COUNT(*) FROM token_deals WHERE status = \'approved\' AND deleted_at IS NULL'
    + ' AND invalid_at IS NULL AND (expires_at IS NULL OR expires_at = 0 OR expires_at > ?)', Date.now(),
  ))
  check('快照里公开可见条数 = 63（80 条中其余为待审/失效/过期/已删）',
    publicVisible > 0 && publicVisible < 80, `visible=${publicVisible}`)
  check('迁移后通告列表 200 且条数与公开可见口径一致',
    legacy.status === 200 && (legacy.json?.deals || []).length === publicVisible,
    `status=${legacy.status} n=${(legacy.json?.deals || []).length} expect=${publicVisible}`)
  const legacyDeals = legacy.json?.deals || []
  check('存量通告 real_name 全部读作空串（不是 null）—— 前端不渲染徽标',
    legacyDeals.length > 0 && legacyDeals.every(d => d.real_name === ''),
    JSON.stringify(legacyDeals.filter(d => d.real_name !== '').slice(0, 3).map(d => [d.id, d.real_name])))
  const annApi = await api('/api/announcements')
  check('公告接口能读到引导公告', annApi.status === 200 && annApi.text.includes('favshub-data-ops'),
    `status=${annApi.status} ${annApi.text.slice(0, 160)}`)

  // ── 第二次启动：幂等 ──
  await stopApp()
  const logs2 = await startApp(dbPath)
  const log2 = logs2.join('')
  check('二次启动不再添加 real_name（幂等）', !/token_deals 表添加 real_name 字段/.test(log2), log2.slice(-300))
  check('二次启动不再添加游客评测三列（幂等）',
    !/token_deal_guest_reviews 表添加 deleted_at 字段/.test(log2))
  check('二次启动不再灌入引导公告（标题幂等）', !/已灌入技能包引导公告/.test(log2))
  const after2 = snap()
  checkEq('二次启动后数据完全不变（80 / 208 / 3）',
    [after2.deals, after2.reviews, after2.users], [80, 208, 3])
  checkEq('二次启动后公告仍是 2 条（没有重复插入）', after2.announcements, before.announcements + 1)
  checkEq('二次启动后标题唯一：同名公告恰好 1 条',
    withDb(dbPath, db => db.prepare('SELECT COUNT(*) AS c FROM announcements WHERE title = ?').get(SKILL_GUIDE_TITLE).c), 1)
  checkEq('二次启动后 integrity_check 仍 ok', after2.integrity, 'ok')
  await stopApp()
}

/** 生产快照里没有可用的测试账号密码：把既有管理员 `admin_favs` 的密码改成测试口令（**只改副本**） */
function setTestPasswordOnCopy(dbPath, username, password) {
  const bcrypt = requireFromRoot('bcryptjs')
  const hash = bcrypt.hashSync(password, 10)
  const r = withDb(dbPath, db => db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username))
  if (Number(r.changes) !== 1) throw new Error(`未找到用户 ${username}（生产快照的用户名可能已变）`)
}

// ════════════════════════════════════════════════════════════
async function main() {
  console.log(`▶ 工作目录 ${WORK}`)
  console.log(`▶ 起应用（PORT=${APP_PORT}），临时库全部在 /tmp`)
  const freshDb = join(WORK, 'fresh.db')
  await startApp(freshDb)
  ok('应用已就绪')

  await unitClaimUrl()
  await httpSuite(freshDb)
  await stopApp()
  await migrationSuite()
  await productionCopySuite()

  console.log(`\n═══ 结果：${passCount} 通过 / ${failCount} 失败 ═══`)
  if (skipped.length) {
    console.log('\n⚠ 跳过（未验证，不算通过）：')
    for (const s of skipped) console.log('  · ' + s)
  }
  if (failCount) {
    console.log('\n失败项：')
    for (const f of failures) console.log('  · ' + f)
  }
  // 临时库/模块副本清理（/tmp 下的东西不该留给下一次跑）
  try { rmSync(WORK, { recursive: true, force: true }) } catch { /* 忽略 */ }
  process.exit(failCount ? 1 : 0)
}

main().catch(async (err) => {
  console.error('\n脚本异常：', err)
  try { await stopApp() } catch { /* 忽略 */ }
  try { rmSync(WORK, { recursive: true, force: true }) } catch { /* 忽略 */ }
  process.exit(1)
})
