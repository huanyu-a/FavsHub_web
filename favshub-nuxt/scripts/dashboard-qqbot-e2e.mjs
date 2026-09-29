#!/usr/bin/env node
/**
 * dashboard-qqbot-e2e.mjs — 仪表盘角标 + QQ 机器人 端到端冒烟脚本（自包含，node 直跑）
 *
 * 先决条件：`pnpm build` 已产出 `.output/`（脚本会用 `node .output/server/index.mjs` 启动产物）。
 *
 * 流程（对应方案 docs/plans/2026-09-29-dashboard-qqbot.md §B10）：
 *   1. 内置迷你 OneBot mock（逻辑同 scripts/mock-onebot.cjs）监听 127.0.0.1:5701；
 *   2. spawn 应用：PORT=3211 + 临时库 data/e2e-qqbot-<时间戳>.db（启动自动跑迁移）
 *      + NUXT_ADMIN_USERS=e2eadmin + NUXT_QQ_BOT_HTTP_URL + NUXT_QQ_BOT_ACCESS_TOKEN；
 *   3. 断言序列 a–i（全部 HTTP fetch；mock 消息轮询最多 5s）；
 *   4. 任一断言失败打印期望/实际后 exit 1；全部通过清理子进程与临时库后 exit 0。
 *
 * 顺序说明（重要）：管理员「已绑定 QQ 则优先用绑定号」做 @ 目标（§B1），
 *   因此 e2eadmin 的 QQ 绑定必须安排在步骤 d（断言 @88888）**之后**、步骤 g（私聊「待审」）之前；
 *   alice 的绑定安排在步骤 d 之后、e（私聊投稿人）之前。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3211
const BASE = `http://127.0.0.1:${APP_PORT}`
const MOCK_PORT = 5701
const BOT_TOKEN = 'e2e-token'
const GROUP_ID = '123456'
const ADMIN_CONFIG_QQ = '88888' // 步骤 c 设置的 qq_admin_qq（步骤 d 断言 @ 它）

const ADMIN_QQ = '10000'
const ALICE_QQ = '10001'
const BOB_QQ = '10002'

const PASSWORD = 'e2e-pass-123'
let passCount = 0

// ── 通用工具 ────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function log(msg) { console.log(msg) }
function ok(msg) { passCount++; log(`  ✓ ${msg}`) }

function fail(desc, expected, actual) {
  console.error(`\n✗ 断言失败：${desc}`)
  console.error(`  期望：${JSON.stringify(expected)}`)
  console.error(`  实际：${JSON.stringify(actual)}`)
  const err = new Error(`ASSERT_FAIL: ${desc}`)
  err.assertFail = true
  throw err
}

/** 轮询直到 fn() 返回真值；超时抛错（desc 用于报错定位） */
async function poll(fn, { timeout = 5000, interval = 200, desc = '' }) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    last = await fn()
    if (last) return last
    await sleep(interval)
  }
  fail(`轮询超时（${desc}）`, `在 ${timeout}ms 内满足条件`, `超时，最后一次结果：${JSON.stringify(last).slice(0, 300)}`)
}

// ── HTTP 工具 ───────────────────────────────────────────────

async function api(path, { method = 'GET', cookie, body, token } = {}) {
  const headers = {}
  if (cookie) headers.Cookie = cookie
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* 空响应 */ }
  return { res, json }
}

/** 从 set-cookie 头提取可回传的 Cookie 串 */
function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const pairs = list.map(c => c.split(';')[0]).filter(Boolean)
  if (!pairs.length) fail('登录/注册应设置会话 Cookie', '至少一个 Set-Cookie', '无')
  return pairs.join('; ')
}

async function register(username) {
  const { res, json } = await api('/api/auth/register', { method: 'POST', body: { username, password: PASSWORD } })
  if (res.status !== 200) fail(`注册 ${username}`, 200, { status: res.status, body: json })
  return cookieFrom(res)
}

async function login(username) {
  const { res, json } = await api('/api/auth/login', { method: 'POST', body: { username, password: PASSWORD } })
  if (res.status !== 200) fail(`登录 ${username}`, 200, { status: res.status, body: json })
  return cookieFrom(res)
}

// ── 内置迷你 OneBot mock（逻辑同 scripts/mock-onebot.cjs）─────

const mockMessages = []
let mockServer = null

function startMock() {
  return new Promise((resolvePromise) => {
    mockServer = createServer(async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`)
      if (req.method === 'POST' && (url.pathname === '/send_group_msg' || url.pathname === '/send_private_msg')) {
        const auth = String(req.headers['authorization'] || '')
        if (BOT_TOKEN && auth !== `Bearer ${BOT_TOKEN}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'failed', retcode: 401 }))
          return
        }
        const chunks = []
        for await (const c of req) chunks.push(c)
        let payload = {}
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { /* 忽略坏包 */ }
        const kind = url.pathname === '/send_group_msg' ? 'group' : 'private'
        mockMessages.push({ at: Date.now(), kind, ...payload })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: Date.now() } }))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'failed', retcode: 404 }))
    })
    mockServer.listen(MOCK_PORT, '127.0.0.1', resolvePromise)
  })
}

/**
 * 在 mockMessages 里轮询一条消息：kind 匹配、目标匹配（群号/QQ号）、
 * 文本包含 include 的全部子串，且下标 ≥ marker（只看本步骤新收到的消息）。
 */
function pollMock({ kind, target, include = [], marker = 0, desc, timeout = 5000 }) {
  return poll(() => {
    for (let i = marker; i < mockMessages.length; i++) {
      const m = mockMessages[i]
      if (m.kind !== kind) continue
      const t = String(kind === 'group' ? m.group_id : m.user_id ?? '')
      if (String(target) !== t) continue
      const text = String(m.message ?? '')
      if (include.every(s => text.includes(s))) return m
    }
    return null
  }, { timeout, desc })
}

/** 模拟 OneBot 上报一条 QQ 消息到应用入站端点 */
let onebotMsgId = 1000
async function reportOnebot({ message_type, user_id, group_id, raw_message, token = BOT_TOKEN }) {
  const res = await fetch(`${BASE}/api/bot/onebot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      post_type: 'message',
      message_type,
      user_id,
      group_id,
      raw_message,
      message_id: ++onebotMsgId,
      self_id: 999,
      time: Math.floor(Date.now() / 1000),
    }),
  })
  return res
}

// ── 应用进程管理 ────────────────────────────────────────────

let appProcess = null

/**
 * 原生模块预检：better-sqlite3 的 prebuilt 二进制与运行本脚本的 node ABI 不一致时
 * （如 node 大版本升级后未重装依赖），应用会在启动时 ERR_DLOPEN_FAILED，表现为
 * 30s ready 超时。这里先在脚本进程内试加载，失败则尝试 `pnpm rebuild better-sqlite3`
 * 自动修复，并把修复后的二进制同步进 .output（Nitro 构建时是原样拷贝）；
 * 仍失败则快速报错退出，不再空等 30s。
 */
function ensureNativeModule() {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  const load = () => {
    try { requireFromRoot('better-sqlite3'); return true } catch { return false }
  }
  if (!load()) {
    log('  ⚠ better-sqlite3 与当前 node ABI 不匹配，尝试 pnpm rebuild better-sqlite3 …')
    const { status } = spawnSync('pnpm', ['rebuild', 'better-sqlite3'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (!load()) {
      throw new Error(`better-sqlite3 无法在 node ${process.version} 下加载（rebuild 退出码 ${status}）。请手动重装依赖后重试`)
    }
    log('  ✓ better-sqlite3 已重建')
  }
  // node_modules 与 .output 内副本保持一致（Nitro 构建时原样拷贝，构建后 rebuild 不会自动同步）
  const src = join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  const dest = join(ROOT, '.output', 'server', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  try {
    if (existsSync(src) && existsSync(dest)) {
      const a = statSync(src)
      const b = statSync(dest)
      if (a.size !== b.size || a.mtimeMs !== b.mtimeMs) copyFileSync(src, dest)
    }
  } catch { /* 同步失败不阻断（应用大概率仍能启动） */ }
}

async function startApp(dbPath) {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) {
    console.error('未找到 .output/server/index.mjs —— 请先执行 `pnpm build` 再运行本脚本')
    process.exit(1)
  }
  ensureNativeModule()
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(APP_PORT),
      NUXT_DB_PATH: dbPath,
      NUXT_ADMIN_USERS: 'e2eadmin',
      NUXT_QQ_BOT_HTTP_URL: `http://127.0.0.1:${MOCK_PORT}`,
      NUXT_QQ_BOT_ACCESS_TOKEN: BOT_TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => { console.error(`  [app] ${String(d).trim().slice(0, 500)}`) })
  appProcess.on('exit', () => { appProcess = null })

  // 轮询 30s 等 ready（公共只读接口探活）
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetch(`${BASE}/api/search-engines`)
      if (res.ok) return
    } catch { /* 未就绪继续等 */ }
    await sleep(500)
  }
  fail('应用在 30s 内就绪', 'HTTP 200', '超时未就绪')
}

async function stopApp() {
  if (!appProcess) return
  const proc = appProcess
  appProcess = null
  proc.kill('SIGTERM')
  await sleep(300)
  if (!proc.killed) proc.kill('SIGKILL')
}

function cleanupDb(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(dbPath + suffix, { force: true }) } catch { /* 忽略 */ }
  }
}

// ── 断言序列 ────────────────────────────────────────────────

async function main() {
  log('▶ 启动迷你 OneBot mock（127.0.0.1:5701）')
  await startMock()
  ok('mock 已监听 5701')

  const dbPath = join(ROOT, 'data', `e2e-qqbot-${Date.now()}.db`)
  cleanupDb(dbPath) // 启动前删除旧文件（含残留 wal/shm）

  log('▶ 启动应用（PORT=3211，临时库 data/e2e-qqbot-<时间戳>.db）')
  await startApp(dbPath)
  ok('应用已就绪')

  // a. 注册 e2eadmin / alice / bob 并登录
  log('▶ a. 注册并登录 e2eadmin / alice / bob')
  await register('e2eadmin')
  await register('alice')
  await register('bob')
  const adminCookie = await login('e2eadmin')
  const aliceCookie = await login('alice')
  const bobCookie = await login('bob')
  ok('三账号注册登录完成（e2eadmin 经 NUXT_ADMIN_USERS 为管理员）')

  // b. 管理员 stats：初始待审为 0
  log('▶ b. GET /api/admin/stats 初始待审为 0')
  {
    const { res, json } = await api('/api/admin/stats', { cookie: adminCookie })
    if (res.status !== 200) fail('GET /api/admin/stats', 200, { status: res.status, body: json })
    if (json?.tokenDeals?.pending !== 0) fail('stats tokenDeals.pending', 0, json?.tokenDeals?.pending)
    if (json?.promptReviews?.pending !== 0) fail('stats promptReviews.pending', 0, json?.promptReviews?.pending)
    ok('tokenDeals.pending=0，promptReviews.pending=0')
  }

  // c. 管理员配置机器人热配置
  log('▶ c. PUT /api/admin/config 设置 qq_bot_enabled / 群号 / 管理员QQ')
  {
    const { res, json } = await api('/api/admin/config', {
      method: 'PUT',
      cookie: adminCookie,
      body: { data: { qq_bot_enabled: true, qq_bot_group_id: GROUP_ID, qq_admin_qq: ADMIN_CONFIG_QQ } },
    })
    if (res.status !== 200) fail('PUT /api/admin/config', 200, { status: res.status, body: json })
    ok(`已设置 qq_bot_enabled=true、群号 ${GROUP_ID}、管理员QQ ${ADMIN_CONFIG_QQ}`)
  }

  // d. alice 提交通告 → 群消息含「新通告待审」与 @88888；stats pending=1
  log('▶ d. alice 提交通告 → 群·新通告待审（带 @88888）')
  const aliceDeal = {
    provider: 'E2E服务商',
    title: 'E2E 白嫖通告标题',
    url: 'https://example.com/e2e-deal',
    quota: '测试额度',
  }
  let dealId = ''
  let marker = 0 // 每次「触发动作」前重置为当前消息数，轮询只看该动作之后的新消息
  {
    marker = mockMessages.length
    const { res, json } = await api('/api/token-deals', { method: 'POST', cookie: aliceCookie, body: aliceDeal })
    if (res.status !== 200) fail('alice 提交通告', 200, { status: res.status, body: json })
    dealId = json?.deal_id
    if (!dealId) fail('提交通告应返回 deal_id', '有 deal_id', json)
    const msg = await pollMock({ kind: 'group', target: GROUP_ID, include: ['新通告待审', `[CQ:at,qq=${ADMIN_CONFIG_QQ}]`], marker, desc: '群·新通告待审（@88888）' })
    if (!String(msg.message).includes(aliceDeal.title)) fail('群消息应含通告标题', aliceDeal.title, msg.message)
    ok(`mock 收到群消息：「${String(msg.message).slice(0, 60)}…」`)
  }
  {
    const { json } = await api('/api/admin/stats', { cookie: adminCookie })
    if (json?.tokenDeals?.pending !== 1) fail('stats tokenDeals.pending', 1, json?.tokenDeals?.pending)
    ok('stats tokenDeals.pending=1')
  }

  // d+. alice 先绑定 QQ（步骤 e 的「私聊投稿人」依赖绑定；alice 非管理员，不影响 @ 目标）
  log('▶ d+. alice 经机器人绑定 QQ（为步骤 e 的私聊通知做铺垫）')
  await bindViaBot(aliceCookie, ALICE_QQ, 'alice')

  // e. admin 审核通过 → 群「已发布」+ 私聊 alice「通过审核」；stats pending=0
  log('▶ e. admin 审核通过 → 群·已发布 + 私聊 alice·通过审核')
  {
    marker = mockMessages.length
    const { res, json } = await api(`/api/admin/token-deals/${dealId}/review`, { method: 'POST', cookie: adminCookie, body: { action: 'approve' } })
    if (res.status !== 200) fail('admin approve 通告', 200, { status: res.status, body: json })
    const groupMsg = await pollMock({ kind: 'group', target: GROUP_ID, include: ['已发布', aliceDeal.title], marker, desc: '群·已发布' })
    ok(`mock 收到群消息：「${String(groupMsg.message).slice(0, 50)}」`)
    const privMsg = await pollMock({ kind: 'private', target: ALICE_QQ, include: ['通过审核'], marker, desc: '私聊 alice·通过审核' })
    ok(`mock 收到私聊（${ALICE_QQ}）：「${String(privMsg.message).slice(0, 50)}」`)
  }
  {
    const { json } = await api('/api/admin/stats', { cookie: adminCookie })
    if (json?.tokenDeals?.pending !== 0) fail('stats tokenDeals.pending', 0, json?.tokenDeals?.pending)
    ok('stats tokenDeals.pending=0')
  }

  // f. bob 绑定流程 + 入站鉴权
  log('▶ f. bob 绑定：绑定码 → 私聊指令 → 回执；错误 token / 总开关关闭 → 403')
  await bindViaBot(bobCookie, BOB_QQ, 'bob')
  {
    // 错误 token → 403
    const bad = await reportOnebot({ message_type: 'private', user_id: BOB_QQ, raw_message: '通告统计', token: 'wrong-token' })
    if (bad.status !== 403) fail('错误 access_token 应 403', 403, bad.status)
    ok('错误 token → 403')

    // 总开关关闭 → 403
    await api('/api/admin/config', { method: 'PUT', cookie: adminCookie, body: { data: { qq_bot_enabled: false } } })
    const off = await reportOnebot({ message_type: 'private', user_id: BOB_QQ, raw_message: '通告统计' })
    if (off.status !== 403) fail('qq_bot_enabled=false 应 403', 403, off.status)
    ok('qq_bot_enabled=false → 403')
    await api('/api/admin/config', { method: 'PUT', cookie: adminCookie, body: { data: { qq_bot_enabled: true } } })
  }

  // g. bob 投稿一条 + 私聊「我的投稿」；群内个人指令 → 请私聊；admin 群内待审 → 请私聊；admin 私聊待审 → 四个数
  log('▶ g. 个人指令与管理指令的通道/身份校验')
  {
    // bob 先投稿一条（让「我的投稿」有状态可看）
    const bobDeal = { provider: 'E2E服务商', title: 'E2E bob 的投稿', url: 'https://example.com/bob-deal' }
    const { res, json } = await api('/api/token-deals', { method: 'POST', cookie: bobCookie, body: bobDeal })
    if (res.status !== 200) fail('bob 提交通告', 200, { status: res.status, body: json })

    // bob 私聊「我的投稿」→ 回执含状态（⏳ 待审）
    marker = mockMessages.length
    await reportOnebot({ message_type: 'private', user_id: BOB_QQ, raw_message: '我的投稿' })
    const mine = await pollMock({ kind: 'private', target: BOB_QQ, include: ['我的投稿', '待审'], marker, desc: 'bob 私聊·我的投稿' })
    ok(`bob 私聊「我的投稿」回执：「${String(mine.message).slice(0, 50)}」`)

    // bob 群内「我的投稿」→ 回复含「私聊」
    marker = mockMessages.length
    await reportOnebot({ message_type: 'group', user_id: BOB_QQ, group_id: GROUP_ID, raw_message: '我的投稿' })
    const g1 = await pollMock({ kind: 'group', target: GROUP_ID, include: ['私聊'], marker, desc: 'bob 群内·我的投稿' })
    ok(`bob 群内个人指令回复：「${g1.message}」`)

    // e2eadmin 绑定 QQ（必须在步骤 d 之后绑定：绑定号优先于 qq_admin_qq 做 @ 目标）
    await bindViaBot(adminCookie, ADMIN_QQ, 'e2eadmin')

    // admin 群内「待审」→ 固定回复含「私聊」
    marker = mockMessages.length
    await reportOnebot({ message_type: 'group', user_id: ADMIN_QQ, group_id: GROUP_ID, raw_message: '待审' })
    const g2 = await pollMock({ kind: 'group', target: GROUP_ID, include: ['私聊'], marker, desc: 'admin 群内·待审' })
    ok(`admin 群内指令回复：「${g2.message}」`)

    // admin 私聊「待审」→ 回执含四个待审数
    marker = mockMessages.length
    await reportOnebot({ message_type: 'private', user_id: ADMIN_QQ, raw_message: '待审' })
    const g3 = await pollMock({
      kind: 'private', target: ADMIN_QQ, marker, desc: 'admin 私聊·待审',
      include: ['待审通告', '待审修改建议', '待审提示词审核', '待审游客评测'],
    })
    ok(`admin 私聊「待审」回执含四个待审数：「${String(g3.message).replace(/\n/g, ' / ').slice(0, 80)}…」`)
  }

  // h. 群内「最新通告」→ 回执含已发布通告标题
  log('▶ h. 群内「最新通告」→ 含已发布通告标题')
  {
    marker = mockMessages.length
    await reportOnebot({ message_type: 'group', user_id: BOB_QQ, group_id: GROUP_ID, raw_message: '最新通告' })
    const h = await pollMock({ kind: 'group', target: GROUP_ID, include: ['最新通告', aliceDeal.title], marker, desc: '群·最新通告' })
    ok(`mock 收到群消息：「${String(h.message).replace(/\n/g, ' / ').slice(0, 80)}…」`)
  }

  // i. 提示词审核通知：admin 建公开提示词 → alice 提审 → 群消息含「提示词」且带 @ → admin approve → 私聊 alice
  log('▶ i. 提示词修改审核通知链路')
  {
    const prompt = { title: 'E2E 公开提示词', description: '端到端测试', content: '测试内容', login_required: 0 }
    const created = await api('/api/prompts', { method: 'POST', cookie: adminCookie, body: prompt })
    if (created.res.status !== 200) fail('admin 创建公开提示词', 200, { status: created.res.status, body: created.json })
    const promptId = created.json?.prompt?.prompt_id || created.json?.prompt?.id
    if (!promptId) fail('创建提示词应返回 prompt id', '有 id', created.json)

    marker = mockMessages.length
    const req = await api(`/api/prompts/${promptId}/review-request`, {
      method: 'POST', cookie: aliceCookie,
      body: { title: 'E2E 公开提示词（改）', description: '端到端测试修改', content: '测试内容修改版', tags: [] },
    })
    if (req.res.status !== 200) fail('alice 提交提示词审核请求', 200, { status: req.res.status, body: req.json })
    const reviewId = req.json?.review_id
    if (!reviewId) fail('审核请求应返回 review_id', '有 review_id', req.json)

    const groupMsg = await pollMock({ kind: 'group', target: GROUP_ID, include: ['提示词', '[CQ:at,qq='], marker, desc: '群·提示词待审（带 @）' })
    ok(`mock 收到群消息：「${String(groupMsg.message).slice(0, 60)}…」`)

    marker = mockMessages.length
    const approve = await api(`/api/admin/prompts/review-requests/${reviewId}/approve`, { method: 'POST', cookie: adminCookie })
    if (approve.res.status !== 200) fail('admin 审核通过提示词修改', 200, { status: approve.res.status, body: approve.json })
    const privMsg = await pollMock({ kind: 'private', target: ALICE_QQ, include: ['已通过审核'], marker, desc: '私聊 alice·提示词通过' })
    ok(`mock 收到私聊（${ALICE_QQ}）：「${String(privMsg.message).slice(0, 60)}」`)
  }

  // 「驳回」写库语义与 admin review 端点共享 reviewDealById，approve 路径已验证，此处不再重复

  log(`\n✅ 全部 ${passCount} 项断言通过`)
}

/** 网站侧拿绑定码 + 模拟 QQ 私聊发送「绑定 <code>」+ 轮询回执 */
async function bindViaBot(cookie, qq, username) {
  const marker = mockMessages.length
  const { res, json } = await api('/api/qq/bind-code', { method: 'POST', cookie })
  if (res.status !== 200) fail(`${username} 生成绑定码`, 200, { status: res.status, body: json })
  if (!json?.code || json.bound) fail(`${username} 绑定码应有效且未绑定`, { code: '6位数字', bound: null }, json)

  const report = await reportOnebot({ message_type: 'private', user_id: qq, raw_message: `绑定 ${json.code}` })
  if (report.status !== 200) fail(`${username} 绑定指令上报`, 200, report.status)

  const reply = await pollMock({ kind: 'private', target: qq, include: ['已绑定账号'], marker, desc: `${username} 绑定回执` })
  ok(`${username}（QQ ${qq}）绑定回执：「${reply.message}」`)
}

// ── 入口 ────────────────────────────────────────────────────

const dataDir = join(ROOT, 'data')

async function run() {
  try {
    await main()
  } catch (err) {
    if (!err?.assertFail) {
      console.error('\n✗ 脚本异常：', err?.stack || err?.message || err)
    }
    process.exitCode = 1
  } finally {
    await stopApp()
    if (mockServer) {
      await new Promise(r => mockServer.close(r))
    }
    // 清理全部 e2e 临时库（含本次与历史残留）
    try {
      for (const f of readdirSync(dataDir)) {
        if (f.startsWith('e2e-qqbot-')) {
          try { rmSync(join(dataDir, f), { force: true }) } catch { /* 忽略 */ }
        }
      }
    } catch { /* data 目录不存在等 */ }
    if (process.exitCode === 1) {
      console.error('\n结果：FAIL（exit 1）')
    } else {
      console.log('结果：PASS（exit 0）')
    }
  }
}

// ESM 顶层：直接跑
await run()
