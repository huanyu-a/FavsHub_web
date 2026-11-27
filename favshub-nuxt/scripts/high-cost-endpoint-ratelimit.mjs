#!/usr/bin/env node
/**
 * high-cost-endpoint-ratelimit.mjs — 高成本端点 L3 限频的**真实 Nitro 服务**端到端验证（自包含，node 直跑）
 *
 * 对应 tests/api-rate-limits.test.ts 的源码级断言，这里跑的是**真服务 + 临时 SQLite**：
 *
 *   (a) GET  /api/search               同一 IP   30 次/60 秒 → 前 30 次 200、第 31 次 429
 *   (b) POST /api/sync/upload-preview  认证后同一用户 20 次/60 秒 → 前 20 次 200、第 21 次 429
 *
 * 同时验证「既有顺序不被误改、成功请求不被误伤」：
 *   - search：query 参数校验（缺 q / 非法 limit）在限频**之前**——桶被打满后缺 q 仍回 400 而非 429；
 *     且这些 400 不消耗配额（否则第 30 次成功会错位，本脚本会立刻红）。
 *   - upload-preview：requireAuth 在限频之前（无令牌恒 401），限频在 readBody 之前
 *     （桶满后非法 body 也是 429 而不是 400——这是**既有设计顺序**，不是缺陷）。
 *   - 分桶维度：search 换 IP 即恢复 200（带令牌也不豁免）；upload-preview 换用户即恢复 200。
 *
 * Retry-After（硬断言，不再是 WARN）：
 *   L3 固定窗口 checkRateLimit() 已通过 RETRY_AFTER_SEC 把剩余秒数挂上错误对象，
 *   由 server/plugins/error-handler.ts 统一写出 `Retry-After` 响应头。
 *   因此两处 429 都必须带该头且为 1..86400 的整数；错误体仍保持 `{ error: string }`。
 *   ⚠️ 这要求 `.output` 是包含该实现的构建产物——旧产物会让这两条硬断言变红（这是特性：
 *   本脚本同时守门「跑的是不是新实现」，不要在旧产物上把断言改松）。
 *
 * 防假绿总闸门：必须恰好 28 项通过、0 失败、0 WARN 才退出 0。
 *   删掉任何一条断言（passCount 变少）或新增任何软 WARN，退出码都会变 1。
 *
 * 安全边界：
 *   - 只打 http://127.0.0.1:<运行时空闲端口>，**绝不请求生产**；不读项目 .env / data/ 下的任何密钥与库。
 *   - JWT secret 用 randomBytes 现场生成，SQLite 在 os.tmpdir() 的临时目录；构建产物先拷快照再启动。
 *   - 只 kill 自己 spawn 的那个 PID；结束时删除临时目录并打印退出/删除证据。
 *   - **清理失败即整体失败**：Nitro 子进程未确认退出、或临时目录删不掉，退出码都是 1（不是 WARN）。
 *
 * 先决条件：已存在 `.output/`（本脚本不 build）。
 * 用法：node scripts/high-cost-endpoint-ratelimit.mjs
 * 退出码：0 恰好 28 项通过且 0 失败 0 WARN、清理完成 / 1 其它任何情况
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { startWithFreePort } from './lib/free-port.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const requireFromRoot = createRequire(join(ROOT, 'package.json'))
const jwt = requireFromRoot('jsonwebtoken')

/** 防假绿：断言总数被删少时总闸门失败（当前结构 = 1 就绪 + (a) 14 + (b) 13） */
const EXPECTED_PASS = 28

const TMP = mkdtempSync(join(tmpdir(), 'favshub-hc-rl-'))
const SNAP = join(TMP, 'output')
const DB_PATH = join(TMP, 'test.db')
// 仅本次进程使用的测试密钥：不写 data/.jwt-secret，也不读任何既有密钥
const SECRET = randomBytes(32).toString('hex')

let PORT = 0
let BASE = ''

let passCount = 0
let failCount = 0
const failures = []
const warnings = []
let requestCount = 0
const sequences = {}

const sleep = ms => new Promise(r => setTimeout(r, ms))
function ok(msg) { passCount++; console.log(`  ✓ ${msg}`) }
function bad(desc, detail) {
  failCount++
  failures.push(`${desc}${detail ? ' — ' + detail : ''}`)
  console.error(`  ✗ ${desc}${detail ? ' — ' + detail : ''}`)
}
function check(desc, cond, detail = '') { cond ? ok(desc) : bad(desc, detail) }
/** 软警告预留口：当前没有任何调用点；一旦出现，总闸门的 `warnings.length === 0` 会让退出码变 1 */
function warn(msg) { warnings.push(msg); console.warn(`  ! WARN ${msg}`) }
function section(title) { console.log(`\n=== ${title} ===`) }

/** 把状态序列压成 `200×30,429×2` 这种一行证据 */
function compress(statuses) {
  const out = []
  for (const s of statuses) {
    const last = out[out.length - 1]
    if (last && last.s === s) last.n++
    else out.push({ s, n: 1 })
  }
  return out.map(x => `${x.s}×${x.n}`).join(',')
}

// ─── HTTP（只打本机回环） ────────────────────────────────────────────────
async function req(path, { method = 'GET', token, ip, headers = {}, body, timeoutMs = 15000 } = {}) {
  const h = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  if (ip) h['x-real-ip'] = ip
  if (body !== undefined) h['content-type'] = 'application/json'
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  requestCount++
  try {
    const res = await fetch(BASE + path, {
      method, headers: h, signal: ac.signal, redirect: 'manual',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON */ }
    return { status: res.status, json, text, headers: res.headers }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 429 的硬断言：状态码 + `{ error:string }` 错误结构 + **必须带合法 Retry-After** + 无乱码头。
 * Retry-After 缺失一律判失败（L3 已实现该头，见文件头）。
 */
function assert429(desc, r) {
  const bodyErr = String(r.json?.error || r.text || '')
  check(`${desc} → 429`, r.status === 429, `status=${r.status} body=${bodyErr.slice(0, 160)}`)
  check(`${desc} 错误结构为 { error: string }`,
    r.status === 429 && typeof r.json?.error === 'string' && r.json.error.length > 0,
    `body=${r.text.slice(0, 200)}`)
  check(`${desc} content-type 为 JSON`, String(r.headers.get('content-type') || '').includes('application/json'),
    `content-type=${r.headers.get('content-type')}`)
  const ra = r.headers.get('retry-after')
  const n = Number(ra)
  check(`${desc} Retry-After 存在且为 1..86400 整数`,
    ra !== null && Number.isInteger(n) && n >= 1 && n <= 86400,
    `retry-after=${ra}（缺失或非法即失败；若 .output 是旧产物请先重建）`)
  const nonAscii = [...r.headers.entries()].filter(([, v]) => /[^\x20-\x7E]/.test(String(v)))
  check(`${desc} 响应头无 latin-1 乱码`, nonAscii.length === 0, JSON.stringify(nonAscii))
}

// ─── 应用进程（只清理自己 spawn 的 PID） ─────────────────────────────────
let appProcess = null
let appExitInfo = null
let startedPid = null

async function startOnce(port) {
  PORT = port
  BASE = `http://127.0.0.1:${port}`
  // 端口重试会再次进入本函数：必须清掉上一次尝试的退出记录，
  // 否则就绪探测会拿旧 child 的 exit 误判「本次启动即退出」
  appExitInfo = null
  console.log(`  · 空闲端口 ${port}，BASE=${BASE}`)
  const entry = join(SNAP, 'server', 'index.mjs')
  const child = spawn(process.execPath, [entry], {
    cwd: SNAP,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      NUXT_DB_PATH: DB_PATH,
      NUXT_JWT_SECRET: SECRET,
      NUXT_TRUST_PROXY: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  appProcess = child
  startedPid = child.pid
  const appLog = []
  child.stdout.on('data', d => appLog.push(String(d)))
  child.stderr.on('data', d => appLog.push(String(d)))
  child.on('exit', (code, signal) => {
    appExitInfo = { pid: child.pid, code, signal }
    if (appProcess === child) appProcess = null
  })

  const start = Date.now()
  while (Date.now() - start < 30_000) {
    if (appExitInfo) {
      throw new Error(`应用启动即退出（code=${appExitInfo.code} signal=${appExitInfo.signal}）：\n${appLog.join('').slice(-1500)}`)
    }
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) return
    } catch { /* 尚未就绪 */ }
    await sleep(200)
  }
  throw new Error('应用 30s 内未就绪\n' + appLog.join('').slice(-2000))
}

async function startApp() {
  return startWithFreePort(async (port) => {
    try {
      return await startOnce(port)
    } catch (e) {
      await stopApp()
      throw e
    }
  }, {
    attempts: 5,
    onRetry: ({ attempt, port, nextPort, error }) => {
      console.error(`  ↻ 第 ${attempt} 次起应用失败（端口 ${port} 冲突），换 ${nextPort}：${String(error?.message || error).split('\n')[0].slice(0, 140)}`)
    },
  })
}

/** @returns true = 没有进程需要清理，或自己 spawn 的那个 PID 已确认退出 */
async function stopApp() {
  const proc = appProcess
  if (!proc) return true
  appProcess = null
  const done = new Promise(resolve => proc.once('exit', resolve))
  proc.kill('SIGTERM')
  await Promise.race([done, sleep(4000)])
  try { proc.kill('SIGKILL') } catch { /* 已退出 */ }
  await Promise.race([done, sleep(1000)])
  await sleep(150)
  return appExitInfo?.pid === proc.pid
}

/** 探活成功 ≠ 迁移完成：等到 users 表真的可查，避免 getAuthRole 打到半初始化的库 */
async function waitForSchema() {
  const Database = requireFromRoot('better-sqlite3')
  let lastErr = null
  for (let i = 0; i < 60; i++) {
    let db = null
    try {
      db = new Database(DB_PATH, { readonly: true })
      db.prepare('SELECT id FROM users LIMIT 1').get()
      db.close()
      return
    } catch (err) {
      lastErr = err
      try { db?.close() } catch { /* 忽略 */ }
      await sleep(250)
    }
  }
  throw new Error(`临时库 15s 内未完成迁移：${lastErr?.message || lastErr}`)
}

const VALID_BODY = { bookmarks: [{ title: '限频自测', url: 'https://ratelimit.example/one', container: 'bar' }] }

async function main() {
  console.log(`▶ 临时目录：${TMP}`)
  console.log('▶ 目标：仅本机回环真实 Nitro 服务；不 build、不碰生产、不读生产密钥/数据')
  if (!existsSync(join(ROOT, '.output', 'server', 'index.mjs'))) {
    console.error('未找到 .output/server/index.mjs —— 请先构建（本脚本不 build）')
    process.exit(1)
  }
  cpSync(join(ROOT, '.output'), SNAP, { recursive: true })
  await startApp()
  await waitForSchema()
  ok(`服务就绪：临时库 ${DB_PATH}（users 表可查），测试 JWT secret 为现场随机值`)

  const userA = jwt.sign({ id: 9101, username: 'rl_user_a' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })
  const userB = jwt.sign({ id: 9102, username: 'rl_user_b' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })

  // ══════════════════════════════════════════════════════════════════════
  section('(a) GET /api/search —— 同一 IP 30 次/60 秒，第 31 次 429')
  // ══════════════════════════════════════════════════════════════════════
  const IP_S = '198.51.100.101'
  const IP_S2 = '198.51.100.102'

  const noQ = await req('/api/search', { ip: IP_S })
  check('缺 q → 400（参数校验先于限频）', noQ.status === 400 && typeof noQ.json?.error === 'string',
    `status=${noQ.status} body=${noQ.text.slice(0, 120)}`)
  const badLimit = await req('/api/search?q=test&limit=99', { ip: IP_S })
  check('非法 limit → 400（先于限频，且不消耗配额）', badLimit.status === 400, `status=${badLimit.status}`)

  const searchStatuses = []
  let firstSearchOk = null
  for (let i = 1; i <= 31; i++) {
    const r = await req('/api/search?q=token&limit=1', { ip: IP_S })
    searchStatuses.push(r.status)
    if (i === 1) firstSearchOk = r
    if (i === 31) assert429('search 第 31 次（同 IP 同窗口）', r)
  }
  sequences.search31 = searchStatuses
  console.log(`  · search 31 次状态序列：${compress(searchStatuses)}`)
  check('search 前 30 次全 200、第 31 次 429',
    searchStatuses.slice(0, 30).every(s => s === 200) && searchStatuses[30] === 429,
    `序列=${searchStatuses.join(',')}`)
  check('search 成功响应确为搜索结果（含 groups 与 query）',
    !!firstSearchOk && firstSearchOk.status === 200 && typeof firstSearchOk.json?.query === 'string'
      && typeof firstSearchOk.json?.groups === 'object',
    firstSearchOk ? `status=${firstSearchOk.status}` : '无响应')
  check('search 成功响应 Cache-Control: no-store',
    String(firstSearchOk?.headers.get('cache-control') || '').includes('no-store'),
    `cache-control=${firstSearchOk?.headers.get('cache-control')}`)

  const search32 = await req('/api/search?q=token&limit=1', { ip: IP_S })
  check('search 第 32 次仍 429（窗口内持续被拒）', search32.status === 429, `status=${search32.status}`)

  const noQAfter = await req('/api/search', { ip: IP_S })
  check('桶打满后缺 q 仍 400 而非 429 —— 参数校验先于限频未被误改',
    noQAfter.status === 400, `status=${noQAfter.status} body=${noQAfter.text.slice(0, 120)}`)

  const otherIp = await req('/api/search?q=token&limit=1', { ip: IP_S2 })
  check('换一个 IP → 200（按 IP 分桶，其他访客不被误伤）', otherIp.status === 200, `status=${otherIp.status}`)

  const withToken = await req('/api/search?q=token&limit=1', { ip: IP_S, token: userA })
  check('已打满 IP 上带登录令牌仍 429（键是 IP 不是用户，认证不豁免）',
    withToken.status === 429, `status=${withToken.status}`)

  // ══════════════════════════════════════════════════════════════════════
  section('(b) POST /api/sync/upload-preview —— 认证后同一用户 20 次/60 秒，第 21 次 429')
  // ══════════════════════════════════════════════════════════════════════
  const IP_U = '198.51.100.111'

  const anon = await req('/api/sync/upload-preview', { method: 'POST', ip: IP_U, body: VALID_BODY })
  check('无令牌 → 401（认证先于限频）', anon.status === 401 && typeof anon.json?.error === 'string',
    `status=${anon.status} body=${anon.text.slice(0, 120)}`)

  const invalidBody = await req('/api/sync/upload-preview', {
    method: 'POST', ip: IP_U, token: userB, body: { bookmarks: 'not-an-array' },
  })
  check('认证后非法 body → 400（bookmarks 必须是数组）',
    invalidBody.status === 400 && String(invalidBody.json?.error || '').includes('数组'),
    `status=${invalidBody.status} body=${invalidBody.text.slice(0, 160)}`)

  const syncStatuses = []
  let firstPreview = null
  for (let i = 1; i <= 21; i++) {
    const r = await req('/api/sync/upload-preview', { method: 'POST', ip: IP_U, token: userA, body: VALID_BODY })
    syncStatuses.push(r.status)
    if (i === 1) firstPreview = r
    if (i === 21) assert429('upload-preview 第 21 次（同用户同窗口）', r)
  }
  sequences.uploadPreview21 = syncStatuses
  console.log(`  · upload-preview 21 次状态序列：${compress(syncStatuses)}`)
  check('upload-preview 前 20 次全 200、第 21 次 429',
    syncStatuses.slice(0, 20).every(s => s === 200) && syncStatuses[20] === 429,
    `序列=${syncStatuses.join(',')}`)
  check('预览成功响应结构合理（added=1 且 revision 为 64 位 hex）',
    !!firstPreview && firstPreview.status === 200 && firstPreview.json?.added === 1
      && /^[a-f0-9]{64}$/.test(String(firstPreview.json?.revision || '')),
    firstPreview ? `status=${firstPreview.status} body=${firstPreview.text.slice(0, 200)}` : '无响应')

  const sync22 = await req('/api/sync/upload-preview', { method: 'POST', ip: IP_U, token: userA, body: VALID_BODY })
  check('upload-preview 第 22 次仍 429', sync22.status === 429, `status=${sync22.status}`)

  const anonAfter = await req('/api/sync/upload-preview', { method: 'POST', ip: IP_U, body: VALID_BODY })
  check('用户桶打满后无令牌仍 401 —— requireAuth 先于限频未被误改',
    anonAfter.status === 401, `status=${anonAfter.status}`)

  const invalidAfter = await req('/api/sync/upload-preview', {
    method: 'POST', ip: IP_U, token: userA, body: { bookmarks: 'not-an-array' },
  })
  check('桶满后非法 body 也 429 —— 限频先于 readBody 的既有顺序未变',
    invalidAfter.status === 429, `status=${invalidAfter.status}`)

  const otherUser = await req('/api/sync/upload-preview', { method: 'POST', ip: IP_U, token: userB, body: VALID_BODY })
  check('换用户（同 IP）→ 200（按用户分桶，他人成功请求不被误伤）',
    otherUser.status === 200, `status=${otherUser.status} body=${otherUser.text.slice(0, 160)}`)

  // ══════════════════════════════════════════════════════════════════════
  section('总结')
  // ══════════════════════════════════════════════════════════════════════
  console.log(`  请求总数：${requestCount}（全部发往 ${BASE}，无生产请求）`)
  console.log(`  search 序列：${compress(sequences.search31)}；upload-preview 序列：${compress(sequences.uploadPreview21)}`)
  // 防假绿总闸门：少一条断言（被删）或多一条 WARN 都不算通过
  if (failCount === 0 && passCount !== EXPECTED_PASS) {
    bad(`断言总数应为 ${EXPECTED_PASS}，实际 ${passCount}（有断言被删改？拒绝假绿）`)
  }
  if (warnings.length > 0) {
    bad(`存在 ${warnings.length} 条 WARN，本套件要求 0 WARN`)
  }
  console.log(`  通过 ${passCount} 项硬断言，失败 ${failCount} 项，WARN ${warnings.length} 项`)
  if (failCount) {
    console.error('  失败项：')
    for (const f of failures) console.error('   - ' + f)
  }
  return failCount === 0 && passCount === EXPECTED_PASS && warnings.length === 0 ? 0 : 1
}

/** @returns true = 临时目录已删除；删不掉是硬失败（调用方据此把退出码置 1） */
function cleanupTemp() {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch (err) {
    console.error(`  ✗ 清理临时目录失败：${err?.message || err}`)
    return false
  }
  const removed = !existsSync(TMP)
  console.log(`  清理证据：临时目录已删除=${removed}（含临时 SQLite 与 .output 快照）`)
  if (!removed) console.error(`  ✗ 临时目录仍存在：${TMP}`)
  return removed
}

// 异常路径也要收掉子进程：进程退出前最后一次同步 kill（只针对自己 spawn 的 PID）
process.on('exit', () => {
  try { appProcess?.kill('SIGKILL') } catch { /* 忽略 */ }
})

// POSIX 下被外层（如 Vitest watchdog）发信号时，先清 Nitro 与临时目录再退出；
// Windows 上 TerminateProcess 不会触发 JS 信号，外层需用 taskkill /T 杀整棵自己 spawn 的树。
let onSignalFired = false
function onSignal(sig) {
  if (onSignalFired) return
  onSignalFired = true
  console.error(`  收到 ${sig}，清理后按失败退出`)
  stopApp()
    .catch(() => false)
    .then(() => { cleanupTemp(); process.exit(1) })
}
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)

let code = 1
try {
  code = await main()
} catch (err) {
  console.error('\n✗ 自测异常终止：', err?.stack || err)
  code = 1
} finally {
  const stopped = await stopApp()
  const exited = !startedPid || appExitInfo?.pid === startedPid
  console.log(`  清理证据：Nitro 子进程 ${appExitInfo ? `PID ${appExitInfo.pid} 已退出 code=${appExitInfo.code} signal=${appExitInfo.signal}` : '未记录到 exit（可能从未启动）'}`)
  const tempRemoved = cleanupTemp()
  if (!stopped || !exited || !tempRemoved) {
    console.error(`  ✗ 清理未完全成功（子进程退出确认=${stopped && exited}，临时目录删除=${tempRemoved}）—— 按失败处理`)
    code = 1
  }
}
process.exit(code)
