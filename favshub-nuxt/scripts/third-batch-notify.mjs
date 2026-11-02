#!/usr/bin/env node
/**
 * third-batch-notify.mjs — 第三批 T4「通知格式统一」端到端自测（自包含，node 直跑）
 *
 * 先决条件：`pnpm build` 已产出 `.output/`。
 *
 * 覆盖范围（server/utils/deal-events.ts + server/utils/qq-notify.ts）：
 *   a. 五类事件（online / offline / updated / renewed / pinned）的 text 非空、单行、≤200 字；
 *   b. 五类事件的 markdown 非空、首行 `### ` 标题、含至少一条 `- ` 字段行；
 *   c. offline 的 markdown / text 里搜不到额度 / 模型 / 领取链接 / 官网链接（内容已消失不该继续分发）；
 *   d. 脱敏事件（deal_redacted:true）的 markdown 只剩标题：无字段行、无任何链接；
 *   e. 五类事件用**同一张结构语料表**校验排版一致性（首行 `### ` + 次行加粗 + `- ` 字段行 + 链接行）；
 *   f. 事件负载的字段审阅：不出现 user_id / deleted_by / verified_by / guest_fingerprint /
 *      submitter / username / nickname 等内部或身份字段；
 *   g. `reason_label` 对 pinned 事件不再为空（此前 pin/unpin 都不在原因表里，与标题自相矛盾）；
 *   h. 枚举字段的差异只在展示层翻中文（`分类 API 额度 → 免费云服务器`），
 *      负载里的 `changes[].from/to` 仍是机器可读原值（订阅方过滤不受影响）；
 *   i. 站内 QQ 通知（qq-notify）的到期日期按**显式东八区**渲染，不依赖进程 TZ：
 *      进程 TZ=UTC 时「2026-11-01 00:30 +08:00」仍必须显示 11-01（本地时区算法会得 10-31）；
 *   j. 站内通知的 markdown 与事件流同一具骨架，且「分类」措辞保持 `分类 免费云服务器`。
 *
 * 用法：node scripts/third-batch-notify.mjs
 *
 * 注：本脚本只验证**站点侧产出的文案**。真实投递到 QQ / 钉钉（hermes send + 平台权限）不在本机能力内，
 * 属未验证项 —— 见报告「未验证」一节。
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3264
const BASE = `http://127.0.0.1:${APP_PORT}`
const STAMP = Date.now()
const DB_PATH = `/tmp/favshub-third-batch-notify-${STAMP}.db`
const SPOOL_BASE = `/tmp/favshub-third-batch-notify-spool-${STAMP}`
const SPOOL = join(SPOOL_BASE, 'qq-outbox')
const PASSWORD = 'E2ePassw0rd!2026'

const KINDS = ['online', 'updated', 'renewed', 'pinned', 'offline']

/** 跨月边界样例：站点时区 11-01 00:30（+08:00）= UTC 10-31 16:30（用 2030 年避免随真实时间自然过期） */
const CROSS_MONTH_EXPIRES = Date.UTC(2030, 9, 31, 16, 30)
const CROSS_MONTH_SITE_TZ = '11-01'
const CROSS_MONTH_UTC = '10-31'

let passCount = 0
let warnCount = 0
const failures = []
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function ok(msg) { passCount++; console.log(`  ✓ ${msg}`) }
function warn(msg) { warnCount++; console.log(`  ⚠ ${msg}`) }
function bad(desc, detail) {
  failures.push(desc)
  console.error(`  ✗ ${desc}${detail !== undefined ? ` — ${detail}` : ''}`)
}
function check(desc, cond, detail) { cond ? ok(desc) : bad(desc, detail) }

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
  try { json = JSON.parse(text) } catch { /* HTML / 空体 */ }
  return { status: res.status, json, text, res }
}
function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  return list.map(c => c.split(';')[0]).filter(Boolean).join('; ')
}

// ── 应用进程 ────────────────────────────────────────────────
let appProcess = null
function ensureNativeModule() {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  const load = () => { try { requireFromRoot('better-sqlite3'); return true } catch { return false } }
  if (!load()) {
    console.log('  ⚠ better-sqlite3 与当前 node ABI 不匹配，尝试 pnpm rebuild …')
    spawnSync('pnpm', ['rebuild', 'better-sqlite3'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (!load()) throw new Error('better-sqlite3 无法在 node ' + process.version + ' 下加载')
  }
}
function disableRegisterChallenge(dbPath) {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  const Database = requireFromRoot('better-sqlite3')
  const db = new Database(dbPath)
  try {
    db.prepare(
      "INSERT INTO system_config(key,value) VALUES('register_turnstile_enabled','false') " +
      "ON CONFLICT(key) DO UPDATE SET value='false'"
    ).run()
  } finally { db.close() }
}
async function startApp() {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 `pnpm build`'); process.exit(1) }
  ensureNativeModule()
  mkdirSync(SPOOL, { recursive: true })
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(APP_PORT),
      NUXT_DB_PATH: DB_PATH,
      NUXT_ADMIN_USERS: 'e2eadmin',
      // 故意把进程 TZ 设成 UTC（生产是 TZ=Asia/Shanghai）：如果实现还在用本地时区，
      // 「11-01 00:30 +08:00」就会渲染成 10-31，断言当场失败。
      // 也就是说这条断言证明的是「实现不依赖 TZ 环境变量」，而不是「线上曾经算错」。
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => { console.error(`  [app] ${String(d).trim().slice(0, 400)}`) })
  appProcess.on('exit', () => { appProcess = null })
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    try { const r = await fetch(`${BASE}/api/announcements`); if (r.ok) return } catch { /* 未就绪 */ }
    await sleep(500)
  }
  throw new Error('应用 30s 内未就绪')
}
async function stopApp() {
  if (!appProcess) return
  const proc = appProcess; appProcess = null
  proc.kill('SIGTERM'); await sleep(300)
  if (!proc.killed) proc.kill('SIGKILL')
}

// ── spool（站内通知的实际产出） ──────────────────────────────
function readSpool() {
  if (!existsSync(SPOOL)) return []
  return readdirSync(SPOOL).filter(n => n.endsWith('.json')).sort().map((file) => {
    try { return { file, entry: JSON.parse(readFileSync(join(SPOOL, file), 'utf8')) } }
    catch { return { file, bad: true } }
  })
}
async function waitSpool(min, desc, { timeout = 12_000 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const items = readSpool()
    if (items.length >= min) return items
    await sleep(200)
  }
  bad(`spool 等待超时：${desc}`, `期望 ≥${min} 条，实际 ${readSpool().length} 条`)
  return readSpool()
}

// ── 事件流 ──────────────────────────────────────────────────
/**
 * 取事件流。
 * 默认走**公开**端点（`/api/token-deals/changes`）；传 `{ cookie, path }` 可改走管理员端点
 * （`/api/admin/token-deals/events`，返回 `{items}` 而非 `{events}`）—— 用于断言
 * 「清洗只作用于公开出口，管理员仍能看到原始差异」。
 */
async function fetchEvents(opts = {}) {
  const path = opts.path || '/api/token-deals/changes?since=0&limit=100'
  const { status, json } = await api(path, opts.cookie ? { cookie: opts.cookie } : {})
  const list = json?.events || json?.items
  if (status !== 200 || !Array.isArray(list)) {
    throw new Error(`GET ${path} 失败：HTTP ${status} ${JSON.stringify(json).slice(0, 200)}`)
  }
  return list
}
/** 取某类事件的最后一条（同一类可能有多条） */
function pick(events, kind) {
  const list = events.filter(e => e.kind === kind)
  return list.length ? list[list.length - 1] : null
}

// ── 结构语料表（五类事件共用同一条断言） ──────────────────────
const MD_STRUCTURE = [
  { name: '首行是 `### ` 标题', test: md => String(md).split('\n')[0].startsWith('### ') },
  { name: '次行是 `**加粗标题**`', test: md => /^\*\*.+\*\*$/.test(String(md).split('\n')[1] || '') },
  { name: '标题与字段之间有空行', test: md => String(md).includes('\n\n- ') },
  { name: '至少一条 `- ` 字段行', test: md => /(^|\n)- \S/.test(String(md)) },
  { name: '无三连空行', test: md => !/\n{3}/.test(String(md)) },
  { name: '无行尾空白', test: md => String(md).split('\n').every(l => l === l.replace(/\s+$/, '')) },
]
const TEXT_STRUCTURE = [
  { name: '单行（无换行）', test: t => !String(t).includes('\n') },
  { name: '非空', test: t => String(t).trim().length > 0 },
  { name: '≤ 200 字（QQ 单条长度护栏）', test: t => [...String(t)].length <= 200 },
  { name: '以 `【标签】` 开头', test: t => /^【[^】]+】/.test(String(t)) },
]
/** 各类型是否应有可点链接行（下架 = 内容已消失，不给可点链接） */
const LINK_EXPECTED = { online: true, updated: true, renewed: true, pinned: true, offline: false }

// ── 断言序列 ────────────────────────────────────────────────
async function main() {
  console.log(`▶ 启动应用（PORT=${APP_PORT}，TZ=UTC，db=${DB_PATH}，spool=${SPOOL}）`)
  await startApp()
  disableRegisterChallenge(DB_PATH)
  ok('应用已就绪（TZ=UTC，模拟线上容器）')

  for (const u of ['e2eadmin', 'alice']) {
    await api('/api/auth/register', { method: 'POST', body: { username: u, password: PASSWORD } })
  }
  const admin = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'e2eadmin', password: PASSWORD } })).res)
  check('管理员登录拿到 Cookie', !!admin)
  const alice = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'alice', password: PASSWORD } })).res)
  check('普通用户 alice 登录拿到 Cookie', !!alice)

  // ── 打开 QQ 机器人出站（outbox 传输，spool 落在 /tmp） ─────
  {
    const { status, json } = await api('/api/admin/config', {
      method: 'PUT', cookie: admin,
      body: { data: {
        qq_bot_enabled: 'true',
        qq_bot_transport: 'outbox',
        qq_outbox_path: SPOOL,
        qq_bot_group_id: 'e2e-group',   // 裸 id → 消费端归一化为 qqbot:
        qq_admin_qq: '',
      } },
    })
    check('切换 qq_bot_transport=outbox', status === 200, JSON.stringify(json).slice(0, 160))
  }

  // ═══ 准备数据：A = 五类事件的主角；C = 云服务器（分类措辞） ═══
  const dealA = {
    provider: 'A服务商', title: 'T4 通告 A：注册送额度',
    url: 'https://example.com/a', call_url: 'https://example.com/a/redeem',
    quota: '40 美元/月', models: ['GLM-5', 'MiMo'],
    region: 'cn', quality: '中品', category: 'token',
    expires_at: CROSS_MONTH_EXPIRES, real_name: 'no', note: '备注 A',
  }
  let idA = ''
  {
    const { status, json } = await api('/api/token-deals', { method: 'POST', cookie: admin, body: dealA })
    check('admin 发布通告 A → online 事件', status === 200, JSON.stringify(json).slice(0, 200))
    idA = String(json?.deal_id || json?.id || '')
    check('拿到通告 A 的 id', !!idA, JSON.stringify(json).slice(0, 200))
  }
  let idC = ''
  {
    const { status, json } = await api('/api/token-deals', {
      method: 'POST', cookie: admin,
      body: { ...dealA, title: 'T4 通告 C：免费云服务器', provider: 'C服务商', category: 'cloud', url: 'https://example.com/c', call_url: '' },
    })
    check('admin 发布云服务器通告 C', status === 200, JSON.stringify(json).slice(0, 200))
    idC = String(json?.deal_id || json?.id || '')
  }
  // 通告 B：alice 投稿（pending）→ 管理员通过。这条路径的入参是**库行**（snake_case），
  // 用来独立证明「到期按东八区渲染」在库行路径上同样成立（不只是提交载荷凑巧成立）。
  let idB = ''
  {
    const { status, json } = await api('/api/token-deals', {
      method: 'POST', cookie: alice,
      body: { ...dealA, title: 'T4 通告 B：待审后通过', provider: 'B服务商', url: 'https://example.com/b', call_url: 'https://example.com/b/redeem' },
    })
    check('alice 投交通告 B（pending）', status === 200, JSON.stringify(json).slice(0, 200))
    idB = String(json?.deal_id || '')
    check('拿到通告 B 的 id', !!idB, JSON.stringify(json).slice(0, 200))
    const { status: ast } = await api(`/api/admin/token-deals/${idB}/review`, { method: 'POST', cookie: admin, body: { action: 'approve' } })
    check('admin 审核通过通告 B', ast === 200, ast)
  }

  // ── 站点侧通知（spool）：到期东八区 + 分类措辞 + 统一骨架 ──
  console.log('\n▶ (i)(j) 站内 QQ 通知：到期按东八区渲染 / 分类措辞 / 骨架一致')
  {
    const items = await waitSpool(4, '四条站内通知（A发布 / C发布 / B待审 / B通过；删除通知在本步之后才产生）')
    const cards = items.filter(i => !i.bad).map(i => ({ ...i, md: String(i.entry.markdown || ''), text: String(i.entry.text || '') }))
    check('站内通知都在 qqbot: 目标上（消费端会用 markdown）', cards.length > 0 && cards.every(c => c.entry.target === 'qqbot:e2e-group'),
      cards.map(c => c.entry.target).join(','))
    const cardA = cards.find(c => c.md.includes(dealA.title) && c.md.includes('新通告发布'))
    const cardC = cards.find(c => c.md.includes('T4 通告 C'))
    check('找到通告 A 的「新通告发布」卡片', !!cardA)
    check('找到通告 C 的「新通告发布」卡片', !!cardC)
    if (cardA) {
      check(`(i) 进程 TZ=UTC 时到期仍渲染为 ${CROSS_MONTH_SITE_TZ}（显式东八区，不受 TZ 影响；本地时区算法会得 ${CROSS_MONTH_UTC}）`,
        cardA.md.includes(`- 到期 ${CROSS_MONTH_SITE_TZ}`) && !cardA.md.includes(CROSS_MONTH_UTC),
        cardA.md.split('\n').filter(l => l.includes('到期')).join(' | '))
      check('(j) 站内通知首行 `### `', cardA.md.startsWith('### '), cardA.md.split('\n')[0])
      check('(j) 站内通知含 `- ` 字段行', /(^|\n)- \S/.test(cardA.md))
      // 链接文案有两处来源：事件卡用「查看通告」，通知卡用「查看详情」——两种都认，
      // 之前只认前者，导致明明有链接却走到 warn 分支（断言过时，不是真缺陷）。
      const hasLink = /\[(查看通告|查看详情)\]\(/.test(cardA.md) && cardA.md.includes(`/tokens/${idA}.html`)
      check('(j) 站内通知含可点详情链接（伪静态地址）', hasLink,
        `尾部=${JSON.stringify(cardA.md.split('\n').slice(-1)[0])}`)
      check('站内通知 text 保持紧凑（无空行）', !cardA.text.includes('\n\n'), JSON.stringify(cardA.text).slice(0, 120))
      check('站内通知 text 不含 markdown 标记（纯文本兜底）', !cardA.text.includes('### ') && !cardA.text.includes('**'))
    }
    if (cardC) {
      check('(j) 云服务器通告走 `分类 免费云服务器`（措辞未变）', cardC.md.includes('- 分类 免费云服务器'), cardC.md)
      check('(j) 不再出现旧措辞 `类型 `', !cardC.md.includes('类型 '), cardC.md)
    }
    // 库行路径（审核通过）的独立时区证明：这条通知的 deal 是 SELECT * 出来的行
    const cardApproveB = cards.find(c => c.md.includes('T4 通告 B') && c.md.includes('审核通过'))
    check('找到通告 B 的「审核通过」卡片（库行路径）', !!cardApproveB)
    if (cardApproveB) {
      check(`(i) 库行路径到期同样渲染为 ${CROSS_MONTH_SITE_TZ}（不受进程 TZ 影响）`,
        cardApproveB.md.includes(`- 到期 ${CROSS_MONTH_SITE_TZ}`) && !cardApproveB.md.includes(CROSS_MONTH_UTC),
        cardApproveB.md.split('\n').filter(l => l.includes('到期')).join(' | '))
      check('(i) 库行路径含可点上架链接', cardApproveB.md.includes(`/tokens/${idB}.html`), cardApproveB.md.split('\n').slice(-1)[0])
    }
    // 提交载荷路径（管理员直接发布 / 用户待审）：入参是 camelCase 且没有 id，此前会静默少掉到期行与链接
    const cardPendingB = cards.find(c => c.md.includes('T4 通告 B') && c.md.includes('待审'))
    check('找到通告 B 的「待审」卡片（提交载荷路径）', !!cardPendingB)
    if (cardPendingB) {
      check('(i) 提交载荷路径也带上了到期行（camelCase 归一化）', cardPendingB.md.includes(`- 到期 ${CROSS_MONTH_SITE_TZ}`), cardPendingB.md)
      check('(i) 提交载荷路径的服务商 / 额度行都在', cardPendingB.md.includes('- 服务商 B服务商') && cardPendingB.md.includes('- 额度'), cardPendingB.md)
      check('(j) 待审卡片仍带后台链接 `[去审核](`', cardPendingB.md.includes('[去审核]('), cardPendingB.md)
    }
  }

  // ═══ 五类事件：updated / renewed / pinned（A 仍可见） ═══
  console.log('\n▶ 造 updated：admin 全量 PUT（额度 + 分类 + 实名）')
  {
    const { status, json } = await api(`/api/token-deals/${idA}`, {
      method: 'PUT', cookie: admin,
      body: { ...dealA, quota: '80 美元/月', category: 'cloud', real_name: 'id_card' },
    })
    check('PUT 通告 A', status === 200, JSON.stringify(json).slice(0, 200))
  }
  console.log('▶ 造 renewed：admin extend 有效期')
  {
    const next = CROSS_MONTH_EXPIRES + 30 * 86400000
    const { status, json } = await api(`/api/admin/token-deals/${idA}/restore`, {
      method: 'POST', cookie: admin, body: { action: 'extend', expires_at: next },
    })
    check('extend 通告 A', status === 200, JSON.stringify(json).slice(0, 200))
  }
  console.log('▶ 造 pinned：admin 置顶')
  {
    const { status, json } = await api(`/api/token-deals/${idA}/pin`, { method: 'POST', cookie: admin, body: { pinned: true } })
    check('置顶通告 A', status === 200, JSON.stringify(json).slice(0, 200))
  }

  const liveEvents = await fetchEvents()
  const live = Object.fromEntries(KINDS.map(k => [k, pick(liveEvents, k)]))

  // ═══ 五类事件：offline（删除 A）+ 脱敏 ═══
  console.log('\n▶ 造 offline：admin 软删除通告 A（其后 A 的历史事件在读取时脱敏）')
  {
    const { status } = await api(`/api/token-deals/${idA}`, { method: 'DELETE', cookie: admin })
    check('软删除通告 A', status === 200, status)
  }
  const afterEvents = await fetchEvents()
  const offline = pick(afterEvents, 'offline')
  const redacted = afterEvents.find(e => e.deal_redacted === true && e.deal?.id === idA && e.kind === 'online')

  // ── (a)(b)(e) 五类事件逐条断言 ──────────────────────────
  console.log('\n▶ (a)(b)(e) 五类事件：text / markdown / 同一张结构语料表')
  const corpus = Object.fromEntries(KINDS.map(k => [k, k === 'offline' ? offline : live[k]]))
  for (const kind of KINDS) {
    const ev = corpus[kind]
    if (!ev) { bad(`(${kind}) 事件存在`, '未取到该类型事件'); continue }
    for (const t of TEXT_STRUCTURE) check(`(a) ${kind} text：${t.name}`, t.test(ev.text), JSON.stringify(ev.text).slice(0, 160))
    check(`(b) ${kind} markdown 非空`, String(ev.markdown || '').trim().length > 0)
    for (const m of MD_STRUCTURE) check(`(e) ${kind} markdown：${m.name}`, m.test(ev.markdown), JSON.stringify(ev.markdown).slice(0, 200))
    const hasLink = String(ev.markdown).includes('[查看通告](')
    check(`(e) ${kind} markdown：${LINK_EXPECTED[kind] ? '含' : '不含'}可点链接行`,
      hasLink === LINK_EXPECTED[kind], JSON.stringify(ev.markdown).slice(-160))
  }

  // ── (c) offline 只给标题 + 原因 ──────────────────────────
  console.log('\n▶ (c) offline：额度 / 模型 / 领取链接 / 官网链接一律不下发')
  if (offline) {
    // 注意：不能用「额度」二字判定 —— 标题本身就是「…注册送额度」。按**字段行**与**值**判定。
    const secretBits = [
      ['额度字段行', '- 额度'], ['模型字段行', '- 模型'], ['分类字段行', '- 分类'],
      ['额度值 80 美元/月', '80 美元/月'], ['额度值 40 美元/月', '40 美元/月'],
      ['模型名 GLM-5', 'GLM-5'], ['模型名 MiMo', 'MiMo'],
      ['领取地址', 'example.com/a/redeem'], ['官网地址', 'example.com/a'],
      ['「领取：」前缀', '领取：'], ['「官网：」前缀', '官网：'], ['可点详情链接', '[查看通告]('],
    ]
    for (const [label, needle] of secretBits) {
      check(`(c) offline markdown 搜不到${label}`, !String(offline.markdown).includes(needle), String(offline.markdown))
      check(`(c) offline text 搜不到${label}`, !String(offline.text).includes(needle), String(offline.text))
    }
    check('(c) offline markdown 说明了状态与原因', /- 状态：已下架（.+）/.test(String(offline.markdown)), String(offline.markdown))
  } else {
    bad('(c) offline 事件存在', '未取到 offline 事件')
  }

  // ── (d) 脱敏事件只剩标题 ─────────────────────────────────
  console.log('\n▶ (d) 脱敏事件（deal_redacted:true）：连富文本也只留标题')
  if (redacted) {
    const md = String(redacted.markdown)
    check('(d) 命中脱敏标记', redacted.deal_redacted === true)
    check('(d) markdown 首行仍是 `### ` 标题', md.startsWith('### '), md.split('\n')[0])
    check('(d) markdown 含标题', md.includes(dealA.title), md)
    check('(d) markdown 无 `- ` 字段行', !/(^|\n)- \S/.test(md), md)
    check('(d) markdown 无任何链接', !md.includes('](') && !md.includes('http'), md)
    check('(d) markdown 无额度 / 模型 / 领取 / 官网 / 分类字段行', !/^- (额度|模型|领取|官网|分类|到期)/m.test(md), md)
    check('(d) text 也不再推可点链接', !String(redacted.text).includes('http') && !String(redacted.text).includes('/tokens/'), String(redacted.text))
    // 与富文本同一口径：脱敏后 text 只许剩「【标签】服务商｜标题」，额度 / 到期 / 分类 / 模型 / 评分一律不许带
    // （`到期` 曾从 offlineSnapshot 保留下来的 expires_at 漏出来，与富文本自相矛盾）
    // 按「字段前缀 + 空格」判定，不能用裸词 —— 标题本身就是「…注册送额度」
    for (const f of ['额度', '到期', '分类', '模型', '评分']) {
      check(`(d) 脱敏 text 不含字段「${f} 」`, !String(redacted.text).includes(`${f} `), String(redacted.text))
    }
    check('(d) 脱敏 text 形状 = 【标签】服务商｜标题', /^【[^】]+】[^｜]+｜[^｜]+$/.test(String(redacted.text)), String(redacted.text))
    check('(d) 负载里的 deal 快照已收敛（无额度 / 领取地址）', !redacted.deal?.quota && !redacted.deal?.call_url, JSON.stringify(redacted.deal))
    check('(d) 负载里的 changes 已清空', Array.isArray(redacted.changes) && redacted.changes.length === 0, JSON.stringify(redacted.changes))
  } else {
    bad('(d) 取到 deal_redacted=true 的 online 事件', '未取到（删除后历史事件应被读侧收敛）')
  }
  // 通用口径：任何一条脱敏事件，无论哪种 kind，text 与 markdown 都不得带字段行 / 可点链接
  {
    const redactedAll = afterEvents.filter(e => e.deal_redacted === true)
    // offline 例外：它的「- 状态 / - 原到期」是设计（Lead 裁决保留），且写库时额度/模型/领取
    // 就已剥离，与是否脱敏无关 —— 它本来就不该有链接。
    const mustBeTitleOnly = redactedAll.filter(e => e.kind !== 'offline')
    let hit = 0
    for (const e of mustBeTitleOnly) {
      const blob = `${e.text}\n${e.markdown}`
      // 有 `- ` 字段行 / 有 markdown 链接 / 有裸 URL / 有「字段前缀+值」→ 都算泄露
      if (/(^|\n)- \S|\]\(http|https?:\/\/|额度 \S|到期 \S|模型 \S|分类 \S/.test(blob)) {
        hit++; bad('(d) 脱敏事件仍带字段 / 链接', `${e.kind}: ${e.text} || ${e.markdown}`)
      }
    }
    if (!hit) ok(`(d) ${mustBeTitleOnly.length} 条非下架的脱敏事件（跨 kind）text / markdown 均无字段行与可点链接`)
    // offline 例外单独断言：只许「状态 + 原到期」两行，不许额度/模型/领取/链接
    const offRedacted = redactedAll.filter(e => e.kind === 'offline')
    if (offRedacted.length) {
      const o = offRedacted[0]
      check('(d) 脱敏的下架事件不含额度 / 模型 / 领取 / 官网 / 链接',
        !/额度 \S|模型 \S|领取|官网|\]\(http|https?:\/\//.test(`${o.text}\n${o.markdown}`), o.markdown)
    }
  }

  // ── (f) 字段审阅：不得新增泄露面 ─────────────────────────
  console.log('\n▶ (f) 字段审阅：事件负载不含内部 / 身份字段')
  {
    const forbidden = ['user_id', 'deleted_by', 'verified_by', 'guest_fingerprint', 'submitter', 'username', 'nickname', 'reject_reason', 'ip', 'fingerprint']
    const allowedDealKeys = ['id', 'provider', 'title', 'url', 'quota', 'call_url', 'models', 'region', 'quality', 'category', 'expires_at', 'rating', 'share_path']
    let leaked = 0
    let unexpected = 0
    for (const ev of afterEvents) {
      const keys = Object.keys(ev.deal || {})
      for (const f of forbidden) if (keys.includes(f)) { leaked++; bad(`(f) 事件负载出现内部字段 ${f}`, JSON.stringify(ev.deal).slice(0, 200)) }
      for (const k of keys) if (!allowedDealKeys.includes(k)) { unexpected++; bad(`(f) 快照出现白名单外字段 ${k}`, JSON.stringify(ev.deal).slice(0, 200)) }
      for (const c of (ev.changes || [])) {
        for (const f of forbidden) if (Object.keys(c).includes(f)) bad(`(f) 差异项出现内部字段 ${f}`, JSON.stringify(c))
      }
    }
    if (!leaked && !unexpected) ok(`(f) ${afterEvents.length} 条事件：deal 快照字段与白名单一致，无内部 / 身份字段`)
  }

  // ── (g) reason_label 不再为空 ────────────────────────────
  console.log('\n▶ (g) reason_label：pinned 事件不再空串')
  {
    const pinEv = pick(afterEvents, 'pinned') || live.pinned
    check('(g) pinned 事件存在', !!pinEv)
    if (pinEv) {
      check('(g) pinned.reason = pin', pinEv.reason === 'pin', pinEv.reason)
      check('(g) pinned.reason_label = 已置顶', pinEv.reason_label === '已置顶', JSON.stringify(pinEv.reason_label))
      check('(g) 标题与 reason_label 口径一致', String(pinEv.markdown).split('\n')[0].includes('【置顶】'), String(pinEv.markdown).split('\n')[0])
    }
    const offEv = pick(afterEvents, 'offline')
    if (offEv) check('(g) offline.reason_label 仍是中文原因', !!offEv.reason_label, JSON.stringify(offEv.reason_label))
  }

  // ── (h) 枚举差异只在展示层翻中文 ─────────────────────────
  console.log('\n▶ (h) 枚举差异：展示层中文，负载保持机器可读原值')
  {
    // 必须用删除前取到的那份：删除后读侧会把 changes 清空（脱敏），差异自然就没了
    const upd = live.updated
    check('(h) updated 事件存在（未脱敏视图）', !!upd && upd.deal_redacted !== true, JSON.stringify(upd?.deal_redacted))
    if (upd) {
      const md = String(upd.markdown)
      check('(h) markdown 把 category 翻成中文', /- 分类 API 额度 → 免费云服务器/.test(md), md)
      check('(h) markdown 把 real_name 翻成中文', /- 是否实名 .+ → 需身份证/.test(md), md)
      check('(h) markdown 不再出现英文枚举 token → cloud', !/token → cloud/.test(md), md)
      const catDiff = (upd.changes || []).find(c => c.field === 'category')
      check('(h) changes[].to 仍是原值 cloud（订阅方过滤不受影响）', catDiff?.to === 'cloud', JSON.stringify(catDiff))
      check('(h) changes[].from 仍是原值 token', catDiff?.from === 'token', JSON.stringify(catDiff))
      const rnDiff = (upd.changes || []).find(c => c.field === 'real_name')
      // 历史告警 → 改为正式断言（2026-10-30 四轮）。
      //
      // 原先是 `warn(...)`：`dealToPatchShape()` 当时没有摊平 `real_name` /
      // `real_name_other`，于是任何带 real_name 的 PUT 都会产出假的「是否实名 空 → x」
      // 差异，模板未改也会推一条 updated。
      //
      // 现在 `dealToPatchShape()` 已含 `real_name: deal?.real_name ?? ''`
      // （`?? ''` 是为了兜住「旧库列尚未迁移」的 undefined），缺陷不复存在。
      // 把死掉的 warn 换成断言，防它回归 —— 若谁把这两行删了，这里立刻失败。
      check('(h) real_name 差异的 from 不为空（dealToPatchShape 已摊平）',
        !rnDiff || (rnDiff.from !== null && rnDiff.from !== ''), JSON.stringify(rnDiff))
    }
  }

  // ── (k) 公开事件流不得下发邀请码占位符 / 码池明文（2026-10-30 四轮）──
  //
  // 回归背景：这两类泄露曾真实存在于生产（实测 seq 16 / 51 / 63）。
  //   1. 快照 `url` 存模板原文 → `{邀请码}` 直接出现在 changes / feed / 推送文案里；
  //   2. `meta.changes` 记着 `url` 的 from/to 原始值 → 「写死真实码的链接」改成
  //      「占位符」时，`changes[].from` 就是**带真实码的完整 URL**，而 changes 数组
  //      是公开下发的，等于把码池白送给匿名访客。
  //
  // 修法在 `server/utils/deal-events.ts` 的 `scrubInviteCodeLeak()`（只作用于公开出口
  // `publicEventViews`，管理员端点仍看原始差异）。这里从**外部视角**（拉公开接口）
  // 断言清洗确实生效，且**没有误伤**通告自身的公开领取链接。
  console.log('\n▶ (k) 公开事件流：占位符 / 码池明文一律不下发，公开领取链接保留')
  {
    const PH = ['{邀请码}', '{code}', '{invite_code}', '｛邀请码｝']
    // 造一条「用码池机制」的通告：url 写占位符 + 码池里放一个可识别的码。
    // 随后把 url 改成「写死该码」再改回占位符 —— 这会产出一条 changes.from 含真实码的
    // updated 事件，正是上面第 2 类泄露的成因。
    const POOL_CODE = `E2E${STAMP.toString(36).slice(-6).toUpperCase()}`
    const phTitle = 'T4 通告 K：占位符与码池'
    let idK = ''
    {
      const { status, json } = await api('/api/token-deals', {
        method: 'POST', cookie: admin,
        body: {
          ...dealA, title: phTitle, provider: 'K服务商',
          url: 'https://example.com/k?ref={邀请码}', call_url: 'https://example.com/k/v1',
        },
      })
      check('(k) 发布含占位符通告 K', status === 200, JSON.stringify(json).slice(0, 200))
      idK = String(json?.deal_id || json?.id || '')
      check('(k) 拿到通告 K 的 id', !!idK)
    }
    if (idK) {
      const put = await api(`/api/token-deals/${idK}/invite-codes`, {
        method: 'PUT', cookie: admin,
        body: { codes: [{ code: POOL_CODE, label: '', weight: 1, copyLimit: 0, enabled: true }] },
      })
      check('(k) 写入码池', put.status === 200, JSON.stringify(put.json).slice(0, 200))

      // ① url 改成「写死真实码」→ 产出 changes.to 含真实码的 updated 事件
      // ⚠️ PUT 是**整体替换**语义：必须带齐必填字段（provider / title / url），
      // 只传 url 会 400「服务商名称不能为空」。这里以通告 K 的原始内容为基底再改 url。
      const kBase = {
        provider: 'K服务商', title: phTitle,
        call_url: 'https://example.com/k/v1',
        quota: '40 美元/月', models: ['GLM-5', 'MiMo'],
        region: 'cn', quality: '中品', category: 'token',
        expires_at: CROSS_MONTH_EXPIRES, real_name: 'no', note: '备注 K',
      }
      const put1 = await api(`/api/token-deals/${idK}`, {
        method: 'PUT', cookie: admin,
        body: { ...kBase, url: `https://example.com/k?ref=${POOL_CODE}` },
      })
      check('(k) PUT url=写死真实码 → 200', put1.status === 200, JSON.stringify(put1.json).slice(0, 200))
      // ② 再改回占位符 → 产出 changes.from 含真实码的 updated 事件（第 2 类泄露的典型形态）
      const put2 = await api(`/api/token-deals/${idK}`, {
        method: 'PUT', cookie: admin,
        body: { ...kBase, url: 'https://example.com/k?ref={邀请码}' },
      })
      check('(k) PUT url=占位符 → 200', put2.status === 200, JSON.stringify(put2.json).slice(0, 200))

      const pubEvents = await fetchEvents()
      const kEvents = pubEvents.filter(e => e.deal?.id === idK)
      check('(k) 通告 K 产生了事件', kEvents.length > 0, String(kEvents.length))

      // 断言 1：公开事件流任何字段都不含占位符
      let phHit = 0
      for (const ev of pubEvents) {
        if (PH.some(p => JSON.stringify(ev).includes(p))) {
          phHit++
          bad('(k) 公开事件流出现占位符', `seq=${ev.seq} ${JSON.stringify(ev).slice(0, 200)}`)
        }
      }
      if (!phHit) ok(`(k) ${pubEvents.length} 条公开事件均不含占位符`)

      // 断言 2：公开事件流任何字段都不含码池里的码
      let codeHit = 0
      for (const ev of pubEvents) {
        if (JSON.stringify(ev).includes(POOL_CODE)) {
          codeHit++
          bad('(k) 公开事件流泄露码池明文', `seq=${ev.seq} ${JSON.stringify(ev).slice(0, 240)}`)
        }
      }
      if (!codeHit) ok('(k) 公开事件流不含码池明文（含 changes.from 的历史值）')

      // 断言 2b：**停用**的码同样要清洗。
      //
      // 实现里刻意用「全量码池」而不是「可用码池」（`pickInviteCode` 才只取可用码）：
      // 已停用 / 已用满的码只是不再发给新访客，但它仍是秘密 —— 从公开事件流里读出来
      // 照样能手动拿去用（`copy_limit` 只约束本站计数，拦不住抄写）。
      // 若有人「优化」成只查 enabled=1，这条断言会立刻失败。
      {
        const disabledCode = `E2EDIS${STAMP.toString(36).slice(-5).toUpperCase()}`
        const putDis = await api(`/api/token-deals/${idK}/invite-codes`, {
          method: 'PUT', cookie: admin,
          // 保留原码（否则 url 里那个码会被当成「新码」），再追加一个**停用**的码
          body: { codes: [
            { code: POOL_CODE, label: '', weight: 1, copyLimit: 0, enabled: true },
            { code: disabledCode, label: '', weight: 1, copyLimit: 0, enabled: false },
          ] },
        })
        check('(k) 写入一个停用的码', putDis.status === 200, JSON.stringify(putDis.json).slice(0, 200))
        // 把停用码写进 url 再改回占位符 → 产出 changes 里含停用码的事件
        await api(`/api/token-deals/${idK}`, {
          method: 'PUT', cookie: admin,
          body: { ...kBase, url: `https://example.com/k?ref=${disabledCode}` },
        })
        await api(`/api/token-deals/${idK}`, {
          method: 'PUT', cookie: admin,
          body: { ...kBase, url: 'https://example.com/k?ref={邀请码}' },
        })
        const pub2 = await fetchEvents()
        const disHit = pub2.filter(e => JSON.stringify(e).includes(disabledCode))
        check('(k) 停用的码也不得出现在公开事件流', disHit.length === 0,
          disHit.map(e => `seq=${e.seq}`).join(','))
      }

      // 断言 3：**没有误伤** —— 通告自身的公开领取链接（不含码池码）应原样保留。
      //
      // ⚠️ 注意选谁做样本：通告 A 在本步之前已被软删除（`▶ 造 offline` 段），
      // 而公开事件流对**不可见**通告会走 `offlineSnapshot()` 脱敏（`deal.url` 被清空）——
      // 那是既有的可见性收敛，不是误伤。所以这里必须用**仍然可见**的通告：
      // 通告 C（云服务器，`url: https://example.com/c`）全程未删除。
      const cEv = pubEvents.find(e => e.deal?.id === idC && e.deal?.url)
      check('(k) 公开领取链接未被误清空（可见通告 C 的 url 仍在）',
        !!cEv && String(cEv.deal.url).includes('example.com/c'), JSON.stringify(cEv?.deal?.url))

      // 断言 4：管理员端点仍能看到原始差异（清洗只在公开出口）。
      // ⚠️ 必须显式带 `limit=200`：该端点默认只返回最近 **50** 条，而测试库里事件
      // 早已超过 50（通告 K 的 url 变更排在较早位置），用默认值会取不到而误报「未记录」。
      const adminEv = await fetchEvents({ cookie: admin, path: '/api/admin/token-deals/events?limit=200' })
      const adminK = adminEv.filter(e => e.deal?.id === idK && (e.changes || []).some(c => c.field === 'url'))
      check('(k) 管理员端点仍保留 url 原始差异（清洗只作用于公开出口）', adminK.length > 0, String(adminK.length))
      if (adminK.length) {
        // 原始差异里应当仍能看到「写死真实码」那一端 —— 证明清洗没有污染管理员视图
        const blob = JSON.stringify(adminK.map(e => e.changes))
        check('(k) 管理员视图仍含真实码原文（未被清洗）', blob.includes(POOL_CODE), blob.slice(0, 200))
      }
    }
  }

  // ── 附近不变量：品级 / 地区不进推送 ───────────────────────
  console.log('\n▶ 既有不变量：事件 markdown 不含品级 / 地区行')
  {
    let hit = 0
    for (const ev of afterEvents) {
      if (/^- (中品|上品|精品|下品|国内|海外)$/m.test(String(ev.markdown))) { hit++; bad('事件 markdown 含品级 / 地区行', String(ev.markdown)) }
    }
    if (!hit) ok(`不变量成立：${afterEvents.length} 条事件均无品级 / 地区行`)
  }

  // ── 五份实际输出原样打印（供人工比对排版） ────────────────
  console.log('\n══════════ 五类事件实际输出（原样，供人工比对） ══════════')
  for (const kind of KINDS) {
    const ev = corpus[kind]
    if (!ev) continue
    console.log(`\n───── ${kind}（seq=${ev.seq} kind_label=${ev.kind_label} reason=${JSON.stringify(ev.reason)} reason_label=${JSON.stringify(ev.reason_label)}）`)
    console.log('[text]')
    console.log(ev.text)
    console.log('[markdown]')
    console.log(ev.markdown)
  }
  if (redacted) {
    console.log(`\n───── online（脱敏 deal_redacted=true，seq=${redacted.seq}）`)
    console.log('[text]')
    console.log(redacted.text)
    console.log('[markdown]')
    console.log(redacted.markdown)
  }
  console.log('\n═══════════════════════════════════════════════════════')
}

let exitCode = 0
try {
  await main()
} catch (err) {
  bad('脚本异常', err?.stack || err?.message || String(err))
} finally {
  await stopApp()
  for (const p of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) { try { rmSync(p, { force: true }) } catch { /* 忽略 */ } }
  try { rmSync(SPOOL_BASE, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

console.log(`\n结果：通过 ${passCount} 项，失败 ${failures.length} 项，观察 ${warnCount} 项`)
if (failures.length) {
  console.error('失败清单：')
  for (const f of failures) console.error(`  - ${f}`)
  exitCode = 1
}
process.exit(exitCode)
