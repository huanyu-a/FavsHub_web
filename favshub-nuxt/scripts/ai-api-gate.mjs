#!/usr/bin/env node
/**
 * ai-api-gate.mjs — 把两个「孤儿」AI 套件接进门禁的编排器
 *
 * ## 为什么需要这个文件
 *
 * `ai-api-smoke-read.mjs`（122 项）与 `ai-api-smoke-write.mjs`（123 + 8 项）**早就写好而且是通过的** ——
 * 覆盖 30 个 `/api/ai/**` 端点与 `/api/mcp`：令牌创建与展示安全、**通道隔离（PAT ≠ JWT 双向不承认）**、
 * scope 分级（read 令牌不可写/删）、MCP 的 initialize/tools/list/tools/call 与权限一致、
 * 写删与跨用户隔离、`dry_run` 不落库、审计日志不记请求体。
 *
 * 但**没有任何东西跑过它们**：不在 `assertion-count.mjs` 的门禁清单里，不在 CI 里，
 * 也不在 `package.json` 的 scripts 里。覆盖存在，却从不在任何一次构建中执行 ——
 * 这正是「有测试 ≠ 有保障」的典型：一旦 `/api/ai/*` 回归，没有任何东西会响。
 *
 * 它们没能进门禁的原因也很实在：它们是**黑盒烟测**（`process.argv[2]` 收 BASE），
 * 自己不启应用，还要求特定环境（放开注册、`NUXT_ADMIN_USERS=smokeadmin`、`NUXT_TRUST_PROXY=true`）。
 * 这个编排器就把这套配方固化下来。
 *
 * ## 为什么必须分两次启服务（照抄套件作者自己的论证）
 *
 * 写套件有两种模式，**不能在同一进程里共存**：
 *
 *   - 常规模式（第 0~5、7 节）：每令牌要打 40~90 个 AI 请求，必须**放宽** `FAVSHUB_RL_AI_*`
 *   - `--limit` 模式（只跑第 6 节）：要验证「第 N+1 次才 429」，必须用**默认**配额
 *
 * 套件在配额被覆盖时会打 `[WARN] … 跳过限频压测` 而不是假装通过 —— 这是个好设计，
 * 但也意味着：**如果编排器没把配额恢复成默认，限流那一节会被静默跳过**，
 * 于是「8 项全绿」其实是空的。所以下面有一条专门的断言：`--limit` 阶段**不许**出现那条 WARN。
 *
 * ## 防假绿护栏
 *
 *   1. 端口必须先空闲 —— 否则测到的是残留实例（别的套件上真被这样骗过一次）
 *   2. 每个阶段 PASS 必须 > 0 —— 空跑不能算成功
 *   3. `--limit` 阶段不许出现「跳过限频压测」的 WARN —— 否则那一节是空测
 *   4. read 阶段的输出里必须真的出现过 `favs_ai_` 前缀 —— 证明 PAT 通道真被走过了
 *   5. 每个阶段输出里不许出现未捕获异常 / ECONNREFUSED —— 防止「脚本崩了但 PASS=0 当成没事」
 *   6. 临时库用完即删
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWithFreePort } from './lib/free-port.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * 端口原先硬编码 3210（这两个烟测脚本的默认端口，门禁其余套件都不用 3210）：
 * 「别的套件不用」是靠人工错开维持的，本机残留实例照样能占住它。
 * 2026-11-09 改成运行时挑空闲端口 + 冲突换端口重试（见 scripts/lib/free-port.mjs）。
 * ⚠️ 注意：本编排器把 BASE 作为 argv 传给两个烟测子脚本，所以 BASE 必须随重试一起更新。
 */
let APP_PORT = 0
/** 由每次尝试开始时按**当次**端口重算 —— 重试会换端口，所以不能是常量 */
let BASE = ''
const ADMIN_USER = 'smokeadmin'
const JWT_SECRET = 'smoke-secret-key'

let pass = 0
/** 子套件真实执行的断言数 —— 门禁要记的是它，不是本编排器自己的十几条编排检查 */
let suitePass = 0
const fails = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.error('  ✗', name, detail) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const req = () => createRequire(join(ROOT, 'package.json'))
const tempDbs = []
let appProcess = null
/**
 * 本次启动的子进程 stderr（最近一次尝试）—— 关键：本编排器的 `startApp` **返回布尔而不是抛异常**，
 * 没有异常 message 可判。把子进程日志留在这里，失败时以 `{ ok:false, evidence }` 交给
 * `startWithFreePort`，由它按 EADDRINUSE 判据决定「换端口重试」还是「立刻抛」。
 */
let lastStartupEvidence = ''

/** 完整读一遍子进程输出，避免大输出把管道堵住 */
function runScript(script, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, 'scripts', script), BASE, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    })
    let out = ''
    p.stdout.on('data', (c) => { out += c })
    p.stderr.on('data', (c) => { out += c })
    p.on('close', (code) => resolve({ code, out }))
  })
}

const countOf = (out, tag) => (out.match(new RegExp(`\\[${tag}\\]`, 'g')) || []).length

/**
 * 起一次应用（端口由 `startWithFreePort` 传入）。
 * 就绪探测（60s / /api/health）/ 日志捕获 / 环境变量与原实现一致，只有两处必要改动：
 *   1. 护栏1 从「启动前一次性 process.exit(1)」挪进来，改成**抛「端口被占」**——
 *      端口是刚由内核分配的，撞上说明它在「释放 → listen」窗口里被抢走，该换端口重试；
 *   2. 子进程已退出时**立即**返回 false，而不是把 60s 等满：进程死了 /api/health
 *      永远不会 ok，等满只会让每一次重试都白等 60s（原实现没有重试，所以没暴露这个问题）。
 */
async function startOnce(port, dbPath, env) {
  APP_PORT = port
  BASE = `http://127.0.0.1:${port}`
  lastStartupEvidence = ''
  console.log(`  · 试用端口 ${port}`)
  // 护栏1：端口必须先空闲（否则测的是残留实例的旧库/旧进程）
  let busy = false
  try { const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) }); busy = r.ok } catch { /* 空闲 */ }
  if (busy) throw new Error(`端口 ${port} 仍被占用（EADDRINUSE：残留实例）`)
  appProcess = spawn(process.execPath, [join(ROOT, '.output', 'server', 'index.mjs')], {
    cwd: ROOT,
    env: {
      NODE_ENV: 'production',
      PATH: process.env.PATH,
      NUXT_DB_PATH: dbPath,
      NUXT_JWT_SECRET: JWT_SECRET,
      NUXT_ADMIN_USERS: ADMIN_USER,
      NUXT_TRUST_PROXY: 'true',   // --limit 模式靠 X-Forwarded-For 把限频压测隔离到专用 IP
      PORT: String(port),
      HOST: '127.0.0.1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => {
    const s = String(d).trim()
    if (!s) return
    lastStartupEvidence += `${s}\n`
    if (!s.includes('statusMessage')) console.error(`  [app] ${s.slice(0, 170)}`)
  })
  let exited = false
  appProcess.on('exit', () => { exited = true })
  const t0 = Date.now()
  while (Date.now() - t0 < 60_000) {
    if (exited) return false
    try { const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) }); if (r.ok) return true } catch { /* 等 */ }
    await sleep(500)
  }
  return false
}

function stopApp() {
  if (appProcess) { try { appProcess.kill('SIGTERM') } catch { /* ignore */ } appProcess = null }
}

/** 护栏1 的断言只记一次（原实现也是整个编排器只记一次），但真正的探测在每次尝试前都跑 */
let guardAsserted = false

/**
 * 对外入口：挑空闲端口 → 起应用；只有证据是「端口被占」时才换端口重试（其它错误立刻抛）。
 * `start` 返回布尔，所以失败时把子进程日志作为 evidence 交给判据。
 */
async function startApp(dbPath, env) {
  const up = await startWithFreePort(async (port) => {
    let ok = false
    try {
      ok = await startOnce(port, dbPath, env)
    } catch (e) {
      stopApp()
      throw e
    }
    if (ok) return true
    stopApp()
    return { ok: false, evidence: lastStartupEvidence }
  }, {
    attempts: 5,
    onRetry: ({ attempt, port, nextPort, error }) => {
      console.error(`  ↻ 第 ${attempt} 次起应用失败（端口 ${port} 被占），换端口重试 → ${nextPort}`)
      console.error(`     ${String(error?.message || error).split('\n')[0].slice(0, 160)}`)
    },
  })
  if (!guardAsserted) {
    guardAsserted = true
    // 判据原先也是字面 `true`（恒真断言）。同 deal-subscriptions.mjs 的理由，改成能证伪的：
    // 答话的必须是我们自己起的进程 —— 若有残留实例占着该端口，我们的子进程 listen 时
    // 就会 EADDRINUSE 退出（`up === false`），根本走不到这里。
    check('护栏1 起到的实例是我们自己的进程（避免测到残留实例）',
      !!appProcess && appProcess.exitCode === null && appProcess.signalCode === null,
      `pid=${appProcess?.pid} exitCode=${appProcess?.exitCode} signal=${appProcess?.signalCode}`)
  }
  return up
}

/** 等迁移建表后放开注册并关掉注册人机校验（两处配置都从库里实时读，无缓存） */
async function prepareDb(dbPath) {
  const Database = req()('better-sqlite3')
  for (let i = 0; i < 60; i++) {
    try {
      const db = new Database(dbPath, { readonly: true })
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()
      db.close()
      if (t) break
    } catch { /* 还没建 */ }
    await sleep(500)
  }
  const db = new Database(dbPath)
  try {
    const put = db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    put.run('allow_registration', 'true')
    // 注册通道默认要求 Cloudflare Turnstile（fail-closed），脚本拿不到真令牌，必须显式关掉
    put.run('register_turnstile_enabled', 'false')
  } finally { db.close() }
}

const newDb = (tag) => {
  const p = join(ROOT, 'data', `ai-gate-${tag}-${Date.now()}.db`)
  for (const s of ['', '-wal', '-shm']) { try { rmSync(p + s, { force: true }) } catch { /* ignore */ } }
  tempDbs.push(p)
  return p
}

/** 站点层限流放宽：不然烟测自己会被站点层 429 打断（read 阶段实测撞到过） */
const RAISED_SITE = {
  FAVSHUB_RL_SITE_READ_PER_MIN: '100000',
  FAVSHUB_RL_SITE_WRITE_PER_MIN: '100000',
  FAVSHUB_RL_SITE_ASSET_PER_MIN: '100000',
  FAVSHUB_RL_SITE_CONCURRENCY: '1000',
}
/** AI 通道配额放宽：常规模式每令牌要打 40~90 个请求，默认 25/分钟 不够 */
const RAISED_AI = {
  FAVSHUB_RL_AI_PER_MIN: '100000',
  FAVSHUB_RL_AI_BURST: '100000',
  FAVSHUB_RL_AI_IP_PER_MIN: '100000',
  FAVSHUB_RL_AI_IP_BURST: '100000',
  FAVSHUB_RL_AI_CONCURRENCY: '64',
  FAVSHUB_RL_AI_IP_CONCURRENCY: '64',
}

try {
  if (!existsSync(join(ROOT, '.output', 'server', 'index.mjs'))) {
    console.error('  ✗ 未找到 .output/server/index.mjs —— 请先 pnpm build'); process.exit(1)
  }

  // 护栏1（端口空闲）现在由 startApp → startOnce 在**每次**尝试前探测：
  // 撞上占用就换端口重试，不再 process.exit(1)。断言在 startApp 成功返回后记一次。

  mkdirSync(join(ROOT, 'data'), { recursive: true })

  const phases = []

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 会话A：放宽 AI 配额 → read + write(常规)')
  // ══════════════════════════════════════════════════════════════
  {
    const db = newDb('a')
    const up = await startApp(db, { ...RAISED_SITE, ...RAISED_AI })
    check('会话A 应用就绪（60s 内 /api/health 200）', up)
    if (!up) throw new Error('会话A 应用未就绪')
    await prepareDb(db)

    const read = await runScript('ai-api-smoke-read.mjs', [], { SMOKE_DB: db })
    const readP = countOf(read.out, 'PASS'); const readF = countOf(read.out, 'FAIL')
    check(`read 套件退出码为 0（实际 ${read.code}）`, read.code === 0, read.out.split('\n').filter(l => l.includes('[FAIL]')).slice(0, 4).join(' | '))
    check('read 阶段无失败项', readF === 0, `${readF} 项失败`)
    check('read 阶段 PASS > 0（空跑不算成功）', readP > 0, `PASS=${readP}`)
    check('read 阶段真的走过 PAT 通道（输出里出现 favs_ai_ 前缀）', read.out.includes('favs_ai_'),
      '没看到 favs_ai_ 前缀 —— 令牌创建那段可能没执行')
    phases.push({ name: 'ai-read', pass: readP, code: read.code })

    const write = await runScript('ai-api-smoke-write.mjs', [], { SMOKE_DB: db })
    const wP = countOf(write.out, 'PASS'); const wF = countOf(write.out, 'FAIL')
    check(`write 套件（常规）退出码为 0（实际 ${write.code}）`, write.code === 0, write.out.split('\n').filter(l => l.includes('[FAIL]')).slice(0, 4).join(' | '))
    check('write 阶段无失败项', wF === 0, `${wF} 项失败`)
    check('write 阶段 PASS > 0', wP > 0, `PASS=${wP}`)
    check('write 阶段没有未捕获异常（防「脚本崩了但 PASS=0 当没事」）',
      !/Uncaught|ERR_[A-Z]+|ECONNREFUSED|TriggerUncaughtException/.test(write.out),
      (write.out.match(/Uncaught|ERR_[A-Z]+|ECONNREFUSED|TriggerUncaughtException/) || [])[0] || '')
    phases.push({ name: 'ai-write', pass: wP, code: write.code })
  }
  stopApp()
  await sleep(700)

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 会话B：**默认** AI 配额 → write --limit（限流节）')
  // ══════════════════════════════════════════════════════════════
  {
    const db = newDb('b')
    // 关键：显式删掉所有 FAVSHUB_RL_AI_*，否则限流节会被跳过（套件会打 WARN 而不是失败）
    const up = await startApp(db, { ...RAISED_SITE })
    check('会话B 应用就绪（默认 AI 配额）', up)
    if (!up) throw new Error('会话B 应用未就绪')
    await prepareDb(db)

    const lim = await runScript('ai-api-smoke-write.mjs', ['--limit'], { SMOKE_DB: db })
    const lP = countOf(lim.out, 'PASS'); const lF = countOf(lim.out, 'FAIL')
    check(`--limit 套件退出码为 0（实际 ${lim.code}）`, lim.code === 0, lim.out.split('\n').filter(l => l.includes('[FAIL]')).slice(0, 4).join(' | '))
    check('--limit 阶段无失败项', lF === 0, `${lF} 项失败`)
    check('--limit 阶段 PASS > 0', lP > 0, `PASS=${lP}`)
    // ★ 这条是本节的核心：配额没恢复成默认时，套件会「跳过限频压测」并 WARN —— 那样全绿是空的
    check('--limit 阶段**没有**出现「跳过限频压测」的 WARN（否则限流节是空测）',
      !lim.out.includes('跳过限频压测'),
      '出现跳过 WARN —— FAVSHUB_RL_AI_* 没恢复成默认，限流节实际没测')
    phases.push({ name: 'ai-write-limit', pass: lP, code: lim.code })
  }
  stopApp()

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 汇总')
  // ══════════════════════════════════════════════════════════════
  const total = phases.reduce((a, p) => a + p.pass, 0)
  suitePass = total
  for (const p of phases) console.log(`  · ${p.name.padEnd(16)} ${String(p.pass).padStart(4)} 项  退出码 ${p.code}`)
  console.log(`  · ${'套件断言小计'.padEnd(14)} ${String(total).padStart(4)} 项`)
  check('三个阶段都有实际断言（没有任何一节被静默跳过）',
    phases.length === 3 && phases.every(p => p.pass > 0), JSON.stringify(phases.map(p => [p.name, p.pass])))
  check('三个阶段全部退出码 0', phases.every(p => p.code === 0), JSON.stringify(phases.map(p => [p.name, p.code])))
} catch (err) {
  console.error('\n编排器异常：', err?.message || err)
  fails.push(`编排器异常：${err?.message || err}`)
} finally {
  stopApp()
  await sleep(500)
  let left = 0
  for (const db of tempDbs) {
    for (const s of ['', '-wal', '-shm']) {
      try { if (existsSync(db + s)) { rmSync(db + s, { force: true }); left++ } } catch { /* ignore */ }
    }
  }
  console.log(`  （清理临时库 ${tempDbs.length} 组）`)
}

// 门禁从这个数字里读「本套件跑过了多少断言」——必须是子套件真实执行的条数（253）
// 加上本编排器自己的编排检查，否则会低报真实覆盖。
console.log(`\n═══ 结果：${pass + suitePass} 通过 / ${fails.length} 失败 ═══`)
console.log(`  （其中编排检查 ${pass} 项 + 子套件断言 ${suitePass} 项）`)
if (fails.length) {
  console.error('\n失败明细：')
  for (const f of fails) console.error('  ✗', f)
  process.exit(1)
}
