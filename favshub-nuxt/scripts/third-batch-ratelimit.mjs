#!/usr/bin/env node
/**
 * third-batch-ratelimit.mjs — T5 限流与并发 端到端自测（自包含，node 直跑）
 *
 * 先决条件：`pnpm build` 已产出 `.output/`（或先跑 `bash scripts/with-build-lock.sh`）。
 *
 * 覆盖：
 *   (a) AI 通道第 11 次/分钟 → 429，前 10 次 200，且响应头带 `Retry-After`
 *   (b) 30 分钟窗口那条规则（默认 50 次/30 分钟）在**缩短窗口的配置**下可被验证，
 *       并在窗口滑过后恢复 —— 不真等 30 分钟
 *   (c) 并发上限：并发打 N+1 个请求时第 N+1 个被拒；**异常路径**与**客户端中途断开**
 *       之后计数器归零（连续多轮证明不越拒越多）
 *   (d) 全站 IP 分层限频：写/读/资源档各自按阈值拒绝，而**页面 SSR 与静态资源不受影响**；
 *       探活 `/api/health` 豁免
 *   (e) 伪造 `x-forwarded-for` 不能绕过（`NUXT_TRUST_PROXY=false` 时该头被忽略）
 *
 * 为什么能「不真等 30 分钟」：所有阈值与窗口都可用 `FAVSHUB_RL_*` 环境变量覆盖，本脚本按 phase
 * 起停多个服务进程，把 30 分钟窗口缩成 3 秒跑**同一条代码路径**；并做两次隔离实验证明
 * 「两个窗口都生效、不是二选一」（一次只让长窗口卡住，一次只让短窗口卡住）。
 *
 * 用法：node scripts/third-batch-ratelimit.mjs        （端口 3265，临时库在 /tmp）
 * 退出码：0 全通过 / 1 有失败项
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import http from 'node:http'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = 3265
const BASE = `http://127.0.0.1:${PORT}`
const DB_PATH = `/tmp/favshub-rl-${process.pid}-${Date.now()}.db`
/**
 * `.output` 快照目录。
 *
 * 5 个 teammate 共用同一个工作区，别人随时可能 `pnpm build` —— nuxt build 会**先清空**
 * `.output` 再重建，直接跑仓库里的产物会随机踩到「文件不存在 / 半成品」。所以开跑前
 * 把 `.output` 整体拷到 /tmp 再从副本启动，保证整个自测用一个一致的构建产物。
 */
const SNAP = `/tmp/favshub-rl-output-${process.pid}-${Date.now()}`
const PWD = 'RlTest12345'
const USER = 'rltest'

let passCount = 0
let failCount = 0
const failures = []

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function ok(msg) { passCount++; console.log(`  \u2713 ${msg}`) }
function bad(desc, detail) {
  failCount++
  failures.push(`${desc}${detail ? ' — ' + detail : ''}`)
  console.error(`  \u2717 ${desc}${detail ? ' — ' + detail : ''}`)
}
function check(desc, cond, detail = '') { cond ? ok(desc) : bad(desc, detail) }
function section(title) { console.log(`\n=== ${title} ===`) }

// ─── HTTP ──────────────────────────────────────────────────────────────
async function req(path, { method = 'GET', token, ip, xff, headers = {}, body, timeoutMs = 15000 } = {}) {
  const h = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  if (ip) h['x-real-ip'] = ip
  if (xff) h['x-forwarded-for'] = xff
  if (body !== undefined) h['content-type'] = 'application/json'
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, {
      method, headers: h, signal: ac.signal, redirect: 'manual',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* HTML / 空体 */ }
    return { status: res.status, json, text, headers: res.headers }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 打一个「body 发一半就不发了」的连接，让服务端卡在 readBody 里 ——
 * 这是最贴近「服务端确实在处理、且确实占着并发槽位」的构造。
 */
function openHanging(path, { token, ip, declaredLength = 400 }) {
  const h = {
    'content-type': 'application/json',
    'content-length': String(declaredLength),
  }
  if (token) h.authorization = `Bearer ${token}`
  if (ip) h['x-real-ip'] = ip
  const r = http.request({ host: '127.0.0.1', port: PORT, path, method: 'POST', headers: h })
  // 主动 abort 后必然 ECONNRESET，这里必须吞掉，否则进程被 unhandled error 干掉
  r.on('error', () => {})
  r.write('{"items":[')   // 只发 10 字节，剩下 390 字节永不发送 → 服务端 await 住
  return r
}

function destroyAll(list) {
  for (const r of list) { try { r.destroy() } catch { /* 已断开 */ } }
}

// ─── 应用进程 ───────────────────────────────────────────────────────────
let appProcess = null

function ensureNativeModule() {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  try { requireFromRoot('better-sqlite3') } catch {
    throw new Error('better-sqlite3 无法在当前 node 下加载（ABI 不匹配？）—— 先 pnpm rebuild better-sqlite3')
  }
}

async function startApp(extraEnv = {}, label = '') {
  const entry = join(SNAP, 'server', 'index.mjs')
  ensureNativeModule()
  appProcess = spawn('node', [entry], {
    cwd: SNAP,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NUXT_DB_PATH: DB_PATH,
      // 固定密钥：不落 data/.jwt-secret，避免污染共享工作区
      NUXT_JWT_SECRET: 'rl-local-self-test-secret',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const appLog = []
  appProcess.stdout.on('data', d => appLog.push(String(d)))
  appProcess.stderr.on('data', d => appLog.push(String(d)))
  appProcess.on('exit', () => { appProcess = null })

  const start = Date.now()
  while (Date.now() - start < 30_000) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) {
        if (label) console.log(`  [phase] ${label} 已就绪`)
        return
      }
    } catch { /* 还没起来 */ }
    await sleep(200)
  }
  throw new Error(`应用 30s 内未就绪${label ? `（${label}）` : ''}\n` + appLog.join('').slice(-2000))
}

async function stopApp() {
  if (!appProcess) return
  const proc = appProcess
  appProcess = null
  const done = new Promise(resolve => proc.once('exit', resolve))
  proc.kill('SIGTERM')
  await Promise.race([done, sleep(3000)])
  try { proc.kill('SIGKILL') } catch { /* 已退出 */ }
  await sleep(150)   // 等端口释放
}

/**
 * 关闭注册人机校验。
 *
 * 默认 `register_turnstile_enabled=true`，而 turnstile 密钥为空时注册通道整体关闭
 * （返回 400「人机校验未启用，暂时无法注册」）。本脚本只验证限流，不测人机校验，
 * 所以起服务后直接把这枚开关改成 false（与 scripts/second-batch-e2e.mjs 同一做法）。
 */
async function disableRegisterChallenge(dbPath) {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  const Database = requireFromRoot('better-sqlite3')
  // ⚠️ Nitro 是「先监听端口，再由 server plugin 跑迁移」—— `/api/health` 只做 SELECT 1，
  // 探活成功 ≠ 迁移已完成。必须重试到 system_config 真的存在，否则会偶发
  // 「no such table: system_config」（本脚本第一版就这么挂过一次）。
  let lastErr = null
  for (let i = 0; i < 40; i++) {
    const db = new Database(dbPath)
    try {
      db.prepare(
        "INSERT INTO system_config(key,value) VALUES('register_turnstile_enabled','false') "
        + 'ON CONFLICT(key) DO UPDATE SET value=\'false\'',
      ).run()
      db.close()
      return
    } catch (err) {
      lastErr = err
      try { db.close() } catch { /* 忽略 */ }
      await sleep(250)
    }
  }
  throw new Error(`关闭注册人机校验失败（10s 内 system_config 一直不可用）：${lastErr?.message || lastErr}`)
}

// ─── 引导：注册用户 + 建 PAT（只在第一个 phase 做一次，之后复用同一个库） ──
async function bootstrap() {
  const ac = []
  const reg = await req('/api/auth/register', {
    method: 'POST', body: { username: USER, password: PWD, nickname: 'RL 自测' },
  })
  const cookies = typeof reg.headers.getSetCookie === 'function' ? reg.headers.getSetCookie() : []
  let cookie = cookies.map(c => c.split(';')[0]).filter(Boolean).join('; ')
  if (!cookie) {
    const login = await req('/api/auth/login', { method: 'POST', body: { username: USER, password: PWD } })
    const lc = typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : []
    cookie = lc.map(c => c.split(';')[0]).filter(Boolean).join('; ')
    if (!cookie) throw new Error(`注册/登录失败：${reg.status} ${reg.text.slice(0, 200)}`)
  }
  const mk = async (name, scopes) => {
    const t = await req('/api/user/api-tokens', {
      method: 'POST', headers: { cookie }, body: { name: `${name}-${Date.now().toString(36)}`, scopes },
    })
    if (!t.json?.token) throw new Error(`创建 PAT 失败：${t.status} ${t.text.slice(0, 300)}`)
    return t.json.token
  }
  // 两张令牌分别用于「不占配额的探针」与「配额计数」——同一张会让第 11 次的断言错位
  const readPat = await mk('rl-read', ['read'])
  const writePat = await mk('rl-write', ['write'])
  void ac
  return { readPat, writePat }
}

/** 校验一条 429：错误体含指定片段，且 Retry-After 头存在且为正整数 */
function assert429(desc, r, mustInclude) {
  const bodyErr = String(r.json?.error || r.text || '')
  const ra = r.headers.get('retry-after')
  const raNum = Number(ra)
  check(`${desc} → 429`, r.status === 429, `status=${r.status} body=${bodyErr.slice(0, 160)}`)
  check(`${desc} 错误体点名限流层（含「${mustInclude}」）`,
    bodyErr.includes(mustInclude), `body=${bodyErr.slice(0, 220)}`)
  check(`${desc} 带合法 Retry-After`, Number.isFinite(raNum) && raNum >= 1 && raNum <= 86400, `retry-after=${ra}`)
}

async function main() {
  console.log(`▶ 临时库：${DB_PATH}`)
  console.log(`▶ 端口：${PORT}`)
  if (!existsSync(join(ROOT, '.output', 'server', 'index.mjs'))) {
    console.error('未找到 .output/server/index.mjs —— 请先 `bash scripts/with-build-lock.sh`')
    process.exit(1)
  }
  console.log(`▶ 快照构建产物：${SNAP}`)
  cpSync(join(ROOT, '.output'), SNAP, { recursive: true })

  // ══════════════════════════════════════════════════════════════════════
  section('phase 1 · 默认阈值：AI 通道 25 次/分钟 + 250 次/30 分钟')
  console.log('  （本 phase 不覆盖任何 FAVSHUB_RL_*，跑的就是生产默认值）')
  // ══════════════════════════════════════════════════════════════════════
  await startApp({}, 'default')
  await disableRegisterChallenge(DB_PATH)
  const { readPat: PAT_READ, writePat: PAT } = await bootstrap()
  ok('引导完成：注册 + 创建 PAT')

  // describe 的 429 文案必须由阈值表生成（防文档/代码漂移）
  const describe = await req('/api/ai/describe', { token: PAT_READ })
  const describe429 = String(describe.json?.errors?.[429] || '')
  check('describe.errors[429] 由阈值表生成（含「25 次/分钟」与「250 次/30 分钟」）',
    describe429.includes('25 次/分钟') && describe429.includes('250 次/30 分钟'),
    `实际=${describe429}`)
  check('describe 不再出现旧的 600 次/分钟', !describe429.includes('600'), describe429)

  // ── (a) 第 11 次/分钟 → 429 ──────────────────────────────────────────
  section('(a) AI 通道 25 次/分钟')
  const IP_A = '198.51.100.11'
  const statuses = []
  for (let i = 0; i < 26; i++) {
    const r = await req('/api/ai/stats', { token: PAT, ip: IP_A })
    statuses.push(r.status)
    if (i < 25) check(`第 ${i + 1} 次 → 200`, r.status === 200, `status=${r.status} ${r.text.slice(0, 120)}`)
    else assert429('第 26 次（同一令牌同一分钟）', r, '每令牌 25 次/分钟')
  }
  check('前 25 次全 200、第 26 次 429', statuses.slice(0, 25).every(s => s === 200) && statuses[25] === 429,
    `statuses=${statuses.join(',')}`)

  // 另一张令牌（新桶）不受影响 —— 证明键是 per-token 而不是全局
  const otherCookieTok = await (async () => {
    const cookies = await req('/api/auth/login', { method: 'POST', body: { username: USER, password: PWD } })
    const lc = typeof cookies.headers.getSetCookie === 'function' ? cookies.headers.getSetCookie() : []
    const ck = lc.map(c => c.split(';')[0]).filter(Boolean).join('; ')
    const t = await req('/api/user/api-tokens', {
      method: 'POST', headers: { cookie: ck }, body: { name: `rl2-${Date.now().toString(36)}`, scopes: ['read'] },
    })
    return t.json?.token
  })()
  if (otherCookieTok) {
    const r = await req('/api/ai/stats', { token: otherCookieTok, ip: IP_A })
    check('换一张令牌（同 IP）→ 200：令牌配额是按令牌分桶的', r.status === 200, `status=${r.status}`)
  } else {
    bad('创建第二张令牌失败')
  }

  await stopApp()

  // ══════════════════════════════════════════════════════════════════════
  section('(b) 30 分钟窗口：把窗口缩成 3 秒跑同一条代码路径')
  // ══════════════════════════════════════════════════════════════════════
  // 实验 1：把**短窗口**调松（1000 次/分钟），只让长窗口（5 次/3 秒）成为瓶颈
  //         → 第 6 次被拒，证明长窗口独立生效（不是「二选一」里的摆设）
  await startApp({
    FAVSHUB_RL_AI_PER_MIN: '1000',
    FAVSHUB_RL_AI_BURST: '5',
    FAVSHUB_RL_AI_BURST_WINDOW_MS: '3000',
    FAVSHUB_RL_AI_IP_PER_MIN: '100000',
    FAVSHUB_RL_AI_IP_BURST: '100000',
  }, 'burst-window')

  const IP_B = '198.51.100.12'
  for (let i = 0; i < 5; i++) {
    const r = await req('/api/ai/stats', { token: PAT, ip: IP_B })
    check(`长窗口内第 ${i + 1} 次 → 200（短窗口已放宽到 1000/分钟）`, r.status === 200, `status=${r.status}`)
  }
  const sixth = await req('/api/ai/stats', { token: PAT, ip: IP_B })
  assert429('长窗口第 6 次（5 次/3 秒）', sixth, '每令牌 5 次/3 秒')

  // 窗口滑过后必须恢复（等价于「等 30 分钟过去」）
  console.log('  … 等待 3.2s 让窗口滑过（生产里这是 30 分钟）')
  await sleep(3200)
  const afterWindow = await req('/api/ai/stats', { token: PAT, ip: IP_B })
  check('窗口滑过后 → 200（配额恢复）', afterWindow.status === 200, `status=${afterWindow.status}`)
  await stopApp()

  // 实验 2：把**长窗口**调松（1000 次/30 分钟），只让短窗口（5 次/分钟）成为瓶颈
  await startApp({
    FAVSHUB_RL_AI_PER_MIN: '5',
    FAVSHUB_RL_AI_BURST: '1000',
    FAVSHUB_RL_AI_IP_PER_MIN: '100000',
    FAVSHUB_RL_AI_IP_BURST: '100000',
  }, 'minute-window')
  const IP_B2 = '198.51.100.13'
  for (let i = 0; i < 5; i++) {
    const r = await req('/api/ai/stats', { token: PAT, ip: IP_B2 })
    check(`短窗口内第 ${i + 1} 次 → 200（长窗口已放宽到 1000/30 分钟）`, r.status === 200, `status=${r.status}`)
  }
  assert429('短窗口第 6 次（5 次/分钟）', await req('/api/ai/stats', { token: PAT, ip: IP_B2 }), '每令牌 5 次/分钟')
  ok('两个窗口各自独立生效（两次隔离实验各卡住一条）—— 不是二选一')
  await stopApp()

  // ══════════════════════════════════════════════════════════════════════
  section('(c) 并发上限 + 异常/中止路径的计数器释放')
  // ══════════════════════════════════════════════════════════════════════
  await startApp({
    FAVSHUB_RL_AI_PER_MIN: '100000',
    FAVSHUB_RL_AI_BURST: '100000',
    FAVSHUB_RL_AI_IP_PER_MIN: '100000',
    FAVSHUB_RL_AI_IP_BURST: '100000',
    FAVSHUB_RL_AI_CONCURRENCY: '3',
    FAVSHUB_RL_AI_IP_CONCURRENCY: '100',
  }, 'ai-concurrency')

  const IP_C = '198.51.100.21'
  const CONC = 3

  // ① 打满：开 3 个「body 发一半」的连接，第 4 个必须被拒
  let hangs = []
  for (let i = 0; i < CONC; i++) hangs.push(openHanging('/api/ai/bookmarks', { token: PAT, ip: IP_C }))
  await sleep(400)
  const over = await req('/api/ai/bookmarks', {
    method: 'POST', token: PAT, ip: IP_C, body: { title: 'x', url: 'https://example.com/x' },
  })
  assert429(`并发打满 ${CONC} 后再来 1 个`, over, `AI 同令牌并发上限 ${CONC}`)

  // ② 中止全部在途连接 → 槽位必须归还
  destroyAll(hangs)
  hangs = []
  await sleep(600)
  const afterAbort = await req('/api/ai/bookmarks', {
    method: 'POST', token: PAT, ip: IP_C, body: { title: 'abort-recover', url: 'https://example.com/abort-recover' },
  })
  check('客户端全部中止后 → 200（并发计数已归还，没有泄漏）',
    afterAbort.status === 200, `status=${afterAbort.status} ${afterAbort.text.slice(0, 160)}`)

  // ③ 异常路径：连打 5 个必然报错的请求（> 并发上限 3）；若计数泄漏，之后再也进不来
  for (let i = 0; i < 5; i++) {
    const r = await req('/api/ai/bookmarks', { method: 'POST', token: PAT, ip: IP_C, body: { items: [] } })
    check(`异常请求 ${i + 1} 未被并发上限挡住（status=${r.status}，应为 4xx 业务错误而非 429）`,
      r.status !== 429 && r.status >= 400, `status=${r.status}`)
  }
  const afterThrows = await req('/api/ai/bookmarks', {
    method: 'POST', token: PAT, ip: IP_C, body: { title: 'throw-recover', url: 'https://example.com/throw-recover' },
  })
  check('5 次异常之后 → 200（异常路径也释放了槽位）',
    afterThrows.status === 200, `status=${afterThrows.status} ${afterThrows.text.slice(0, 160)}`)

  // ④ 连续 3 轮「打满 → 中止 → 恢复」，每轮都必须还能进 1 个：证明不越拒越多
  let roundsOk = 0
  for (let round = 1; round <= 3; round++) {
    const h = []
    for (let i = 0; i < CONC; i++) h.push(openHanging('/api/ai/bookmarks', { token: PAT, ip: IP_C }))
    await sleep(350)
    const blocked = await req('/api/ai/bookmarks', {
      method: 'POST', token: PAT, ip: IP_C, body: { title: 'x', url: `https://example.com/r${round}` },
    })
    destroyAll(h)
    await sleep(600)
    const recovered = await req('/api/ai/bookmarks', {
      method: 'POST', token: PAT, ip: IP_C, body: { title: `r${round}`, url: `https://example.com/rr${round}` },
    })
    const roundOk = blocked.status === 429 && recovered.status === 200
    if (roundOk) roundsOk++
    check(`第 ${round} 轮：打满被拒(${blocked.status}) → 中止后恢复(${recovered.status})`, roundOk,
      `blocked=${blocked.status} recovered=${recovered.status}`)
  }
  check('连续 3 轮都「能被拒 + 能恢复」→ 并发计数不随轮次累积', roundsOk === 3, `roundsOk=${roundsOk}`)

  // ⑤ per-IP 并发上限独立生效（换一张令牌绕不过去）
  await stopApp()
  await startApp({
    FAVSHUB_RL_AI_PER_MIN: '100000',
    FAVSHUB_RL_AI_BURST: '100000',
    FAVSHUB_RL_AI_IP_PER_MIN: '100000',
    FAVSHUB_RL_AI_IP_BURST: '100000',
    FAVSHUB_RL_AI_CONCURRENCY: '100',
    FAVSHUB_RL_AI_IP_CONCURRENCY: '2',
  }, 'ai-ip-concurrency')
  const IP_C2 = '198.51.100.22'
  const h2 = []
  for (let i = 0; i < 2; i++) h2.push(openHanging('/api/ai/bookmarks', { token: PAT, ip: IP_C2 }))
  await sleep(400)
  const ipOver = await req('/api/ai/bookmarks', {
    method: 'POST', token: PAT, ip: IP_C2, body: { title: 'x', url: 'https://example.com/y' },
  })
  assert429('同 IP 并发打满 2 后再来 1 个（令牌并发已放宽到 100）', ipOver, 'AI 同 IP 并发上限 2')
  destroyAll(h2)
  await sleep(500)
  const ipRecovered = await req('/api/ai/bookmarks', {
    method: 'POST', token: PAT, ip: IP_C2, body: { title: 'ip-recover', url: 'https://example.com/ip-recover' },
  })
  check('同 IP 中止后 → 200（IP 并发计数也归还）', ipRecovered.status === 200, `status=${ipRecovered.status}`)
  await stopApp()

  // ══════════════════════════════════════════════════════════════════════
  section('(d) 全站 IP 分层限频：写更严、读宽松、资源更宽松；页面/静态不受影响')
  // ══════════════════════════════════════════════════════════════════════
  await startApp({
    FAVSHUB_RL_AI_PER_MIN: '100000',
    FAVSHUB_RL_AI_BURST: '100000',
    FAVSHUB_RL_AI_IP_PER_MIN: '100000',
    FAVSHUB_RL_AI_IP_BURST: '100000',
    FAVSHUB_RL_AI_CONCURRENCY: '100',
    FAVSHUB_RL_AI_IP_CONCURRENCY: '100',
    FAVSHUB_RL_SITE_READ_PER_MIN: '4',
    FAVSHUB_RL_SITE_WRITE_PER_MIN: '5',
    FAVSHUB_RL_SITE_ASSET_PER_MIN: '6',
    FAVSHUB_RL_SITE_CONCURRENCY: '1000',
  }, 'site-tiers')

  // 写档
  const IP_W = '198.51.100.31'
  for (let i = 0; i < 5; i++) {
    const r = await req('/api/ai/bookmarks', {
      method: 'POST', token: PAT, ip: IP_W, body: { items: [] },
    })
    check(`写接口第 ${i + 1} 次未被全站限频拦下（status=${r.status} 为业务响应）`, r.status !== 429, `status=${r.status}`)
  }
  assert429('写接口第 6 次', await req('/api/ai/bookmarks', {
    method: 'POST', token: PAT, ip: IP_W, body: { items: [] },
  }), '全站 写接口')

  // 读档（另一个 IP，各档各桶）
  const IP_R = '198.51.100.32'
  for (let i = 0; i < 4; i++) {
    const r = await req('/api/announcements', { ip: IP_R })
    check(`读接口第 ${i + 1} 次 → 200`, r.status === 200, `status=${r.status}`)
  }
  assert429('读接口第 5 次', await req('/api/announcements', { ip: IP_R }), '全站 读接口')

  // 资源档（/api/favicon 走 asset 档，阈值 6 —— 比读档的 4 宽松）
  const IP_ASSET = '198.51.100.33'
  for (let i = 0; i < 6; i++) {
    const r = await req('/api/favicon?domain=localhost', { ip: IP_ASSET })
    check(`资源档第 ${i + 1} 次未被拦下（status=${r.status} 为业务响应，非 429）`, r.status !== 429, `status=${r.status}`)
  }
  assert429('资源档第 7 次', await req('/api/favicon?domain=localhost', { ip: IP_ASSET }), '全站 资源类读接口')

  // 对照：同一 IP 的写桶打满后，页面 SSR 与静态资源必须照旧
  const page = await req('/', { ip: IP_W })
  check('写桶打满后 GET /（页面 SSR）仍 200 —— 页面不进限流中间件', page.status === 200, `status=${page.status}`)
  const staticRes = await req('/favicon.ico', { ip: IP_W })
  check('写桶打满后 GET /favicon.ico（静态资源）仍 200', staticRes.status === 200, `status=${staticRes.status}`)
  const staticNuxt = await req('/robots.txt', { ip: IP_W })
  check('写桶打满后 GET /robots.txt 仍 200', staticNuxt.status === 200, `status=${staticNuxt.status}`)

  // 探活豁免：读桶打满的同一 IP 上，/api/health 必须仍然通
  const health = await req('/api/health', { ip: IP_R })
  check('读桶打满后 GET /api/health 仍 200 —— 探活豁免', health.status === 200, `status=${health.status}`)

  // ══════════════════════════════════════════════════════════════════════
  section('(e) 伪造 x-forwarded-for 不能绕过（NUXT_TRUST_PROXY=false）')
  // ══════════════════════════════════════════════════════════════════════
  // 反证：每次换一个 XFF，但都不带 X-Real-IP → 全部落到 127.0.0.1 这个桶
  const xffStatuses = []
  for (let i = 0; i < 5; i++) {
    const r = await req('/api/announcements', { xff: `203.0.113.${100 + i}` })
    xffStatuses.push(r.status)
  }
  check('轮换 5 个不同的 x-forwarded-for，第 5 次仍被拒 → 该头被忽略，没有绕过',
    xffStatuses.slice(0, 4).every(s => s === 200) && xffStatuses[4] === 429,
    `statuses=${xffStatuses.join(',')}`)

  // 正证：同一台机器上换 X-Real-IP（内网对端才采信）→ 各自独立的桶，都能过
  const realIpStatuses = []
  for (let i = 0; i < 5; i++) {
    const r = await req('/api/announcements', { ip: `198.51.100.${60 + i}` })
    realIpStatuses.push(r.status)
  }
  check('换 5 个不同的 x-real-ip（本机回环对端，按既有 getClientIP 规则采信）→ 各自独立分桶，全 200',
    realIpStatuses.every(s => s === 200), `statuses=${realIpStatuses.join(',')}`)
  await stopApp()

  // ══════════════════════════════════════════════════════════════════════
  section('(d+ 全站同 IP 并发上限')
  // ══════════════════════════════════════════════════════════════════════
  await startApp({
    FAVSHUB_RL_AI_PER_MIN: '100000',
    FAVSHUB_RL_AI_BURST: '100000',
    FAVSHUB_RL_AI_IP_PER_MIN: '100000',
    FAVSHUB_RL_AI_IP_BURST: '100000',
    FAVSHUB_RL_AI_CONCURRENCY: '100',
    FAVSHUB_RL_AI_IP_CONCURRENCY: '100',
    FAVSHUB_RL_SITE_READ_PER_MIN: '1000',
    FAVSHUB_RL_SITE_WRITE_PER_MIN: '1000',
    FAVSHUB_RL_SITE_ASSET_PER_MIN: '1000',
    FAVSHUB_RL_SITE_CONCURRENCY: '2',
  }, 'site-concurrency')

  const IP_SC = '198.51.100.41'
  const hc = []
  for (let i = 0; i < 2; i++) hc.push(openHanging('/api/ai/bookmarks', { token: PAT, ip: IP_SC }))
  await sleep(400)
  assert429('全站同 IP 并发打满 2 后再来 1 个',
    await req('/api/ai/bookmarks', {
      method: 'POST', token: PAT, ip: IP_SC, body: { items: [] },
    }), '全站同 IP 并发上限 2')
  destroyAll(hc)
  await sleep(700)
  const scRecovered = await req('/api/ai/bookmarks', {
    method: 'POST', token: PAT, ip: IP_SC, body: { items: [] },
  })
  check('全站并发：客户端中止后 → 非 429（槽位归还）', scRecovered.status !== 429, `status=${scRecovered.status}`)
  await stopApp()

  // ══════════════════════════════════════════════════════════════════════
  section('(f) 默认阈值实测：读 600/分钟、写 120/分钟 —— 正常流量不被误伤')
  // ══════════════════════════════════════════════════════════════════════
  // 全站阈值保持默认（只把 AI 通道配额放宽，否则第 11 个请求先被令牌配额拦下）
  await startApp({
    FAVSHUB_RL_AI_PER_MIN: '100000',
    FAVSHUB_RL_AI_BURST: '100000',
    FAVSHUB_RL_AI_IP_PER_MIN: '100000',
    FAVSHUB_RL_AI_IP_BURST: '100000',
    FAVSHUB_RL_AI_CONCURRENCY: '100',
    FAVSHUB_RL_AI_IP_CONCURRENCY: '100',
  }, 'site-defaults')

  const IP_FR = '198.51.100.71'
  let readBlockedAt = -1
  for (let i = 1; i <= 601; i++) {
    const r = await req('/api/config/registration', { ip: IP_FR })
    if (r.status === 429) { readBlockedAt = i; break }
  }
  check('默认读档：第 601 次才被拒（前 600 次全通）—— 阈值与文档一致', readBlockedAt === 601, `blockedAt=${readBlockedAt}`)

  const IP_FW = '198.51.100.72'
  let writeBlockedAt = -1
  for (let i = 1; i <= 121; i++) {
    const r = await req('/api/ai/bookmarks', { method: 'POST', token: PAT, ip: IP_FW, body: { items: [] } })
    if (r.status === 429) { writeBlockedAt = i; break }
  }
  check('默认写档：第 121 次才被拒（前 120 次全通，响的是 400 业务错误）—— 阈值与文档一致',
    writeBlockedAt === 121, `blockedAt=${writeBlockedAt}`)
  check('默认阈值下「读 600 + 写 120」这种量级的正常使用不会被误伤',
    readBlockedAt === 601 && writeBlockedAt === 121)
  await stopApp()

  // ══════════════════════════════════════════════════════════════════════
  section('总结')
  // ══════════════════════════════════════════════════════════════════════
  console.log(`  通过 ${passCount} 项，失败 ${failCount} 项`)
  if (failCount) {
    console.error('  失败项：')
    for (const f of failures) console.error('   - ' + f)
  }
  cleanupTemp()
  process.exit(failCount ? 1 : 0)
}

function cleanupTemp() {
  for (const p of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`, SNAP]) {
    try { rmSync(p, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

main().catch(async (err) => {
  console.error('\n✗ 自测异常终止：', err?.stack || err)
  await stopApp()
  cleanupTemp()
  process.exit(1)
})
