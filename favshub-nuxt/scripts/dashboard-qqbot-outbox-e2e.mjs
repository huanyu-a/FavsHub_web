#!/usr/bin/env node
/**
 * dashboard-qqbot-outbox-e2e.mjs — QQ 机器人 outbox（spool 目录）传输 端到端冒烟（自包含，node 直跑）
 *
 * 先决条件：`pnpm build` 已产出 `.output/`。
 *
 * 验证点（server/utils/qq-notify.ts transport='outbox' + scripts/qq-outbox-deliver.py 的生产端契约）：
 *   1. PUT /api/admin/config 切 transport=outbox，群目标为逗号分隔多通道（裸 id 需归一化为 qqbot: 前缀）；
 *   2. alice 投稿 → spool 出现 3 个文件：群×2（qqbot: + dingtalk: 各一）+ 主人私聊×1；
 *      文本做 CQ 反转义（含用户输入的字面 [CQ:test]，不得残留 &#91;）；
 *   3. 模拟消费端投递（逐文件 parse→记录→unlink）→ 断言已投递集合与 spool 清空；
 *   4. admin 审核通过 → 仅新增群×2（投稿人未绑定 → 无私聊），文本含「已发布」；
 *   5. 关闭总开关 → 投稿不产生新文件；
 *   6. python -m py_compile 校验投递脚本语法（本机无 python 则跳过提示）。
 *
 * 真实链路（cron + hermes send → QQ 到达）在服务器部署阶段手动验证。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, appendFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3212
const BASE = `http://127.0.0.1:${APP_PORT}`
const SPOOL = join(ROOT, 'data', `e2e-spool-${Date.now()}`, 'qq-outbox')
// 占位 fixture（测试只用其形状断言前缀归一化/原样透传，不涉及真实通道；真实 ID 只存线上热配置）
const GROUP_QQBOT = 'F00DCAFE0123456789ABCDEF01234567' // 裸 id（无平台前缀），断言归一化
const GROUP_DINGTALK = 'dingtalk:cidE2EFAKE000000000000000000=='
const ADMIN_TARGET = 'A11CE0000000000000000000000000FE' // 主人私聊（裸 id → qqbot:）
const PASSWORD = 'e2e-pass-123'

let passCount = 0
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
function ok(msg) { passCount++; console.log(`  ✓ ${msg}`) }
function fail(desc, expected, actual) {
  console.error(`\n✗ 断言失败：${desc}`)
  console.error(`  期望：${JSON.stringify(expected)}`)
  console.error(`  实际：${JSON.stringify(actual)}`)
  const err = new Error(`ASSERT_FAIL: ${desc}`)
  err.assertFail = true
  throw err
}
async function poll(fn, { timeout = 6000, interval = 200, desc = '' }) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    last = await fn()
    if (last) return last
    await sleep(interval)
  }
  fail(`轮询超时（${desc}）`, '条件满足', `超时，最后结果：${JSON.stringify(last).slice(0, 300)}`)
}

// ── HTTP ────────────────────────────────────────────────────
const BOT_TOKEN = 'e2e-bot-inbound-token'
async function api(path, { method = 'GET', cookie, body } = {}) {
  const headers = {}
  if (cookie) headers.Cookie = cookie
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  let json = null
  try { json = await res.json() } catch {}
  return { res, json }
}
function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const pairs = list.map(c => c.split(';')[0]).filter(Boolean)
  if (!pairs.length) fail('登录/注册应设置会话 Cookie', '至少一个 Set-Cookie', '无')
  return pairs.join('; ')
}

// ── spool 读取 ──────────────────────────────────────────────
function readSpool() {
  if (!existsSync(SPOOL)) return []
  return readdirSync(SPOOL).filter(n => n.endsWith('.json')).map(n => {
    try { return { file: n, entry: JSON.parse(readFileSync(join(SPOOL, n), 'utf8')) } }
    catch { return { file: n, bad: true } }
  })
}
/** 轮询至 spool 出现 ≥expectCount 个文件 */
async function waitSpool(expectCount, desc) {
  return poll(() => {
    const items = readSpool()
    return items.length >= expectCount ? items : null
  }, { desc })
}

// ── 应用进程（同 dashboard-qqbot-e2e.mjs 的 ensureNativeModule + spawn 模式）──
function ensureNativeModule() {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  const load = () => { try { requireFromRoot('better-sqlite3'); return true } catch { return false } }
  if (!load()) {
    console.log('  ⚠ better-sqlite3 与当前 node ABI 不匹配，尝试 pnpm rebuild …')
    spawnSync('pnpm', ['rebuild', 'better-sqlite3'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (!load()) throw new Error('better-sqlite3 无法在 node ' + process.version + ' 下加载')
  }
}
/**
 * 关闭「注册人机校验」（2026-10-12 起默认开启，fail-closed）
 *
 * 本脚本自建临时库并靠 `/api/auth/register` 造账号；Turnstile 是纯浏览器挂件，
 * 脚本拿不到令牌 → 不关掉的话注册必然 400。库里没有 system_config 行时按默认值 true 处理，
 * 所以这里必须显式写 false。
 */
function disableRegisterChallenge(dbPath) {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  const Database = requireFromRoot('better-sqlite3')
  const db = new Database(dbPath)
  try {
    db.prepare(
      "INSERT INTO system_config(key,value) VALUES('register_turnstile_enabled','false') " +
      "ON CONFLICT(key) DO UPDATE SET value='false'"
    ).run()
  } finally {
    db.close()
  }
}

let appProcess = null
async function startApp(dbPath) {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 `pnpm build`'); process.exit(1) }
  ensureNativeModule()
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(APP_PORT),
      NUXT_DB_PATH: dbPath,
      NUXT_ADMIN_USERS: 'e2eadmin',
      NUXT_QQ_BOT_ACCESS_TOKEN: BOT_TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => { console.error(`  [app] ${String(d).trim().slice(0, 500)}`) })
  appProcess.on('exit', () => { appProcess = null })
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    try { const res = await fetch(`${BASE}/api/search-engines`); if (res.ok) return } catch {}
    await sleep(500)
  }
  fail('应用在 30s 内就绪', 'HTTP 200', '超时未就绪')
}
async function stopApp() {
  if (!appProcess) return
  const proc = appProcess; appProcess = null
  proc.kill('SIGTERM'); await sleep(300)
  if (!proc.killed) proc.kill('SIGKILL')
}

// ── 断言序列 ────────────────────────────────────────────────
async function main() {
  mkdirSync(SPOOL, { recursive: true })
  const dbPath = join(ROOT, 'data', `e2e-qqbot-outbox-${Date.now()}.db`)
  console.log(`▶ 启动应用（PORT=${APP_PORT}，spool=${SPOOL}）`)
  await startApp(dbPath)
  ok('应用已就绪')
  disableRegisterChallenge(dbPath)

  // a. 注册登录 + 切换 outbox 传输
  console.log('▶ a. 注册 e2eadmin/alice，PUT config 切 transport=outbox + 多目标')
  await api('/api/auth/register', { method: 'POST', body: { username: 'e2eadmin', password: PASSWORD } })
  await api('/api/auth/register', { method: 'POST', body: { username: 'alice', password: PASSWORD } })
  const { res: lres } = await api('/api/auth/login', { method: 'POST', body: { username: 'e2eadmin', password: PASSWORD } })
  const adminCookie = cookieFrom(lres)
  const { res: ares } = await api('/api/auth/login', { method: 'POST', body: { username: 'alice', password: PASSWORD } })
  const aliceCookie = cookieFrom(ares)
  {
    const { res, json } = await api('/api/admin/config', {
      method: 'PUT', cookie: adminCookie,
      body: {
        data: {
          qq_bot_enabled: true,
          qq_bot_transport: 'outbox',
          qq_outbox_path: SPOOL,
          qq_bot_group_id: `${GROUP_QQBOT},${GROUP_DINGTALK}`,
          qq_admin_qq: ADMIN_TARGET,
        },
      },
    })
    if (res.status !== 200) fail('PUT config outbox 传输', 200, { status: res.status, body: json })
    ok('已切换 qq_bot_transport=outbox')
  }

  // b. alice 投稿（标题含 [CQ: 字面量，验证反转义不残留实体）→ 3 个 spool 文件
  console.log('▶ b. alice 投稿 → spool 应出现 群×2 + 主人私聊×1（目标归一化 + CQ 反转义）')
  const dealTitle = 'Outbox 测试『标题』[CQ:test]'
  let dealId = ''
  {
    const { res, json } = await api('/api/token-deals', { method: 'POST', cookie: aliceCookie, body: { provider: 'E2E服务商', title: dealTitle, url: 'https://example.com/outbox', quota: '测试额度', quality: '中品', region: 'cn' } })
    if (res.status !== 200) fail('alice 提交通告', 200, { status: res.status, body: json })
    dealId = json?.deal_id
    const items = await waitSpool(3, 'spool 出现 3 条出站消息')
    if (items.some(i => i.bad)) fail('spool 文件均为合法 JSON', '无坏文件', items.filter(i => i.bad).map(i => i.file))
    const by = (kind, target) => items.find(i => i.entry.kind === kind && i.entry.target === target)
    const gQ = by('group', `qqbot:${GROUP_QQBOT}`)
    const gD = by('group', GROUP_DINGTALK)
    const pA = by('private', `qqbot:${ADMIN_TARGET}`)
    if (!gQ) fail('裸群 id 归一化为 qqbot: 前缀', `qqbot:${GROUP_QQBOT}`, items.map(i => `${i.entry.kind}:${i.entry.target}`))
    if (!gD) fail('dingtalk: 目标原样保留', GROUP_DINGTALK, items.map(i => `${i.entry.kind}:${i.entry.target}`))
    if (!pA) fail('主人私聊 DM（等价 @ 提醒）', `qqbot:${ADMIN_TARGET}`, items.map(i => `${i.entry.kind}:${i.entry.target}`))
    if (items.length !== 3) fail('待审消息恰好 3 条（群 2 + 私聊 1）', 3, items.length)
    for (const i of [gQ, gD, pA]) {
      const t = String(i.entry.text)
      if (!t.includes('新通告待审') || !t.includes(dealTitle)) fail('消息含事件与标题（反转义后字面 [CQ:test]）', dealTitle, t)
      if (t.includes('&#91;') || t.includes('&#38;') || t.includes('&#93;')) fail('不得残留 CQ HTML 实体', '无反转义残留', t)
      if (!i.entry.at) fail('消息含 ISO 时间戳（消费端按时效丢弃）', '有 at', i.entry)
    }
    ok(`待审 3 条：群·QQ（${gQ.entry.text.slice(0, 26)}…）、群·钉钉、主人私聊各 1，反转义干净`)
    // 富文本：每条都带 markdown（首行 ### 才触发钉钉卡片 / QQ msg_type=2），text 保持单行
    for (const [label, i] of [['群·QQ', gQ], ['群·钉钉', gD], ['主人私聊', pA]]) {
      const md = String(i.entry.markdown || '')
      if (!md.startsWith('### ')) fail(`${label} 带 markdown 且首行是 ### 标题`, '### …', md.slice(0, 40))
      if (!md.includes('**' + dealTitle) && !md.includes('**') ) fail(`${label} markdown 含加粗标题行`, '**…**', md.slice(0, 80))
      if (!md.includes('[去审核](')) fail(`${label} markdown 含后台链接`, '[去审核](…', md)
      if (String(i.entry.text).includes('\n\n')) fail(`${label} text 保持单行紧凑`, '不含空行', i.entry.text)
    }
    ok('待审通知均带 markdown（### 标题 + 列表 + 可点后台链接），text 仍为纯文本')
  }
  {
    const { json } = await api('/api/admin/stats', { cookie: adminCookie })
    if (json?.tokenDeals?.pending !== 1) fail('stats tokenDeals.pending', 1, json?.tokenDeals?.pending)
    ok('stats tokenDeals.pending=1')
  }

  // c. 模拟消费端投递：逐文件 parse → 记录 → unlink
  console.log('▶ c. 模拟 scripts/qq-outbox-deliver.py 消费：投递成功删除、计数落盘')
  {
    const delivered = []
    for (const { file, entry } of readSpool()) {
      delivered.push(`${entry.kind}|${entry.target}`)
      unlinkSync(join(SPOOL, file))
    }
    if (delivered.length !== 3) fail('消费 3 条', 3, delivered)
    if (readSpool().length !== 0) fail('投递后 spool 清空', 0, readSpool().length)
    ok(`消费端契约成立：${delivered.join(' / ')}`)
  }

  // d. admin 审核通过 → 群×2「已发布」（alice 未绑定 → 无私聊）
  console.log('▶ d. admin 审核通过 → 仅群×2「已发布」')
  {
    const { res } = await api(`/api/admin/token-deals/${dealId}/review`, { method: 'POST', cookie: adminCookie, body: { action: 'approve' } })
    if (res.status !== 200) fail('admin approve', 200, res.status)
    const items = await waitSpool(2, 'spool 出现 2 条已发布消息')
    if (items.length !== 2) fail('已发布消息恰好 2 条（无绑定 → 无私聊）', 2, items.map(i => `${i.entry.kind}:${i.entry.target}`))
    for (const i of items) {
      if (i.entry.kind !== 'group') fail('审核结果只到群（本步）', 'group', i.entry.kind)
      if (!String(i.entry.text).includes('已发布') || !String(i.entry.text).includes(dealTitle)) fail('含「已发布」与标题', dealTitle, i.entry.text)
      const md = String(i.entry.markdown || '')
      if (!md.startsWith('### ')) fail('发布通知 markdown 首行 ###', '### …', md.slice(0, 40))
      if (!md.includes('/tokens?deal=')) fail('发布通知 markdown 含可点详情链接', '/tokens?deal=', md)
    }
    ok('审核通过群广播 ×2（qqbot + dingtalk），未绑定用户无私聊 ✓')
  }

  // d1. 公开接口不泄露账号名；事件富文本不带品级/地区
  console.log('▶ d1. 公开接口无 username / 事件 markdown 无品级地区')
  {
    const { json } = await api('/api/token-deals?limit=20')
    const list = json?.deals || []
    if (!list.length) fail('公开列表非空', '至少 1 条', list.length)
    const leak = list.filter(d => 'username' in d)
    if (leak.length) fail('公开列表不得下发 username', '无该字段', Object.keys(leak[0]).filter(k => k === 'username'))
    ok(`公开列表 ${list.length} 条均不含 username`)
    const { json: ch } = await api('/api/token-deals/changes?since=0&limit=20')
    const evs = ch?.events || []
    for (const ev of evs) {
      const md = String(ev.markdown || '')
      if (/^- (中品|精品|国内|海外)$/m.test(md)) fail('事件 markdown 不得含品级/地区行', '无 - 中品/- 国内', md)
      if (!ev.text) fail('事件保留 text 兜底', '非空', ev)
    }
    ok(`事件 ${evs.length} 条：markdown 无品级/地区行，text 兜底仍在`)
  }

  // d2. 指令回复也要成卡片（入站指令 → 出站 markdown）
  console.log('▶ d2. 入站指令「帮助」→ 回复带 markdown')
  {
    for (const { file } of readSpool()) unlinkSync(join(SPOOL, file))
    const res = await fetch(`${BASE}/api/bot/onebot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BOT_TOKEN}` },
      body: JSON.stringify({ post_type: 'message', message_type: 'private', user_id: ADMIN_TARGET, raw_message: '帮助', message_id: 90001 }),
    })
    if (res.status !== 200) fail('入站指令 200', 200, res.status)
    const items = await waitSpool(1, 'spool 出现 1 条指令回复')
    const md = String(items[0]?.entry.markdown || '')
    if (!md.startsWith('### ')) fail('指令回复 markdown 首行 ###', '### …', md.slice(0, 40))
    if (!String(items[0]?.entry.text || '').trim()) fail('指令回复保留纯文本兜底', '非空 text', items[0]?.entry)
    ok(`指令回复成卡片：${md.split('\n')[0].slice(0, 30)}…`)
    for (const { file } of readSpool()) unlinkSync(join(SPOOL, file))
  }

  // e. 总开关关闭 → 出站静默
  console.log('▶ e. qq_bot_enabled=false → 投稿不产生新文件')
  {
    for (const { file } of readSpool()) unlinkSync(join(SPOOL, file))
    await api('/api/admin/config', { method: 'PUT', cookie: adminCookie, body: { data: { qq_bot_enabled: false } } })
    const { res } = await api('/api/token-deals', { method: 'POST', cookie: aliceCookie, body: { provider: 'E2E服务商', title: '关闭后的投稿', url: 'https://example.com/off' } })
    if (res.status !== 200) fail('关闭开关后投稿仍应成功', 200, res.status)
    await sleep(2500) // 覆盖 flush 定时器 3 个周期
    if (readSpool().length !== 0) fail('关闭开关后 spool 为空', 0, readSpool().length)
    ok('总开关关闭 → 业务正常、出站静默 ✓')
  }

  // f. 投递脚本语法校验（本机无 python 则跳过）
  console.log('▶ f. python -m py_compile 校验 qq-outbox-deliver.py')
  {
    const args = ['-m', 'py_compile', join(ROOT, 'scripts', 'qq-outbox-deliver.py')]
    // python 常因环境而不可用（Ubuntu 默认没有 /usr/bin/python；有的机器是未授权别名 → EACCES），
    // 所以只要 spawn 失败就退到 python3
    let py = spawnSync('python', args, { encoding: 'utf8' })
    if (py.error) py = spawnSync('python3', args, { encoding: 'utf8' })
    if (py.error && /ENOENT/.test(String(py.error.code))) {
      console.log('  ⚠ 本机无 python，跳过语法校验（服务器侧手动验证）')
    } else if (py.status !== 0) {
      fail('py_compile', 'exit 0', (py.stderr || py.stdout || '').slice(0, 400))
    } else {
      ok('qq-outbox-deliver.py 语法校验通过')
    }
  }

  console.log(`\n✅ 全部 ${passCount} 项断言通过`)
}

async function run() {
  try { await main() } catch (err) {
    if (!err?.assertFail) console.error('\n✗ 脚本异常：', err?.stack || err?.message || err)
    process.exitCode = 1
  } finally {
    await stopApp()
    // 清理本次临时库与 spool
    try {
      const parent = join(SPOOL, '..', '..')
      if (existsSync(parent)) rmSync(parent, { recursive: true, force: true })
      for (const f of existsSync(join(ROOT, 'data')) ? readdirSync(join(ROOT, 'data')) : []) {
        if (f.startsWith('e2e-qqbot-outbox-')) rmSync(join(ROOT, 'data', f), { force: true })
      }
    } catch {}
    console.log(process.exitCode === 1 ? '结果：FAIL（exit 1）' : '结果：PASS（exit 0）')
  }
}
await run()
