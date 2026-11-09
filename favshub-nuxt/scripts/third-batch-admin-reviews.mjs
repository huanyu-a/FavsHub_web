#!/usr/bin/env node
/**
 * third-batch-admin-reviews.mjs — T3「管理端游客评测列表 + 管理员删除」端到端自测
 *
 * 先决条件：`pnpm build` 已产出 `.output/`（构建须经 scripts/with-build-lock.sh）。
 *
 * 覆盖的验收项（与 task-5 的 (a)~(e) 一一对应，脚本里用 ⓐⓑⓒⓓⓔ 标注）：
 *   ⓐ 未登录访问管理端列表 API → 401
 *   ⓑ 普通登录用户访问 → 403（不是 404，也不给出任何数据）
 *   ⓒ 管理员能拿到游客评测列表；响应里**没有** fingerprint / ip_hash / qq_cipher / user_id
 *     （用哨兵值证明「不是恰好为空，而是真的没下发」）
 *   ⓓ 管理员删除后：该评测从**公开**列表消失，管理端四态筛选里变成「已删」
 *   ⓔ 删除是**软删除**：库里行仍在、deleted_at 非空、deleted_by 为操作者
 * 附加：处置审计留痕、幂等重删、恢复、状态冲突 409、分页/筛选/计数、
 *       删除已通过评测后通告评分重算、页面可达且 HTML 不含敏感字段。
 *
 * 用法：node scripts/third-batch-admin-reviews.mjs
 * 端口：3263（与其他 teammate 的自测端口错开）；临时库：/tmp
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { startWithFreePort } from './lib/free-port.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * 端口原先硬编码 3263：本机任何残留实例占住它，应用就 EADDRINUSE 直接死。
 * 2026-11-09 改成运行时挑空闲端口 + 冲突换端口重试（见 scripts/lib/free-port.mjs）。
 */
let APP_PORT = 0
/** 由每次尝试开始时按**当次**端口重算 —— 重试会换端口，所以不能是常量 */
let BASE = ''
const DB_PATH = `/tmp/favshub-admin-reviews-${Date.now()}.db`
const PASSWORD = 'e2e-admin-reviews-1234'
const ADMIN_USER = 'e2eadmin'

let passCount = 0
let failCount = 0
const failures = []
const sleep = ms => new Promise(r => setTimeout(r, ms))

function ok(msg) { passCount++; console.log(`  ✓ ${msg}`) }
function bad(desc, detail) {
  failCount++
  failures.push(`${desc}${detail ? ' — ' + detail : ''}`)
  console.error(`  ✗ ${desc}${detail ? ' — ' + detail : ''}`)
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
  try { json = JSON.parse(text) } catch { /* HTML */ }
  return { status: res.status, json, text, res }
}
function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  return list.map(c => c.split(';')[0]).filter(Boolean).join('; ')
}

// ── 应用进程 ────────────────────────────────────────────────
let appProcess = null
const requireFromRoot = createRequire(join(ROOT, 'package.json'))
function openDb() {
  const Database = requireFromRoot('better-sqlite3')
  return new Database(DB_PATH, { timeout: 10000 })
}
function ensureNativeModule() {
  const load = () => { try { requireFromRoot('better-sqlite3'); return true } catch { return false } }
  if (!load()) throw new Error('better-sqlite3 无法在当前 node 下加载：' + process.version)
}
/**
 * 起一次应用（端口由 `startWithFreePort` 传入）。就绪探测 / 40s 超时 / 日志捕获 / 环境变量
 * 与原实现一致，另有三处**必要**改动（都是让「换端口重试」真的能触发）：
 *   ① 子进程 stderr 另存一份并带进抛出的错误 —— 端口被占的证据（EADDRINUSE）只在 stderr 里；
 *   ② 子进程已退出时立刻抛错，而不是把 40s 等满；
 *   ③ 探测加 3s 超时：对端「接而不答」时原来的 fetch 会永挂，连 40s 上限都到不了。
 */
async function startOnce(port) {
  APP_PORT = port
  BASE = `http://127.0.0.1:${port}`
  console.log(`  · 试用端口 ${port}`)
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) {
    console.error('未找到 .output/server/index.mjs —— 请先 `bash scripts/with-build-lock.sh`')
    process.exit(1)
  }
  mkdirSync('/tmp', { recursive: true })
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      NUXT_DB_PATH: DB_PATH,
      NUXT_ADMIN_USERS: ADMIN_USER,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  const appLogs = []
  appProcess.stderr.on('data', d => { const s = String(d); appLogs.push(s); console.error(`  [app] ${s.trim().slice(0, 400)}`) })
  let earlyExit = null
  appProcess.on('exit', (code, signal) => { earlyExit = { code, signal }; appProcess = null })
  const start = Date.now()
  while (Date.now() - start < 40_000) {
    if (earlyExit) throw new Error(`应用启动即退出（code=${earlyExit.code} signal=${earlyExit.signal}）：\n${appLogs.join('').slice(-800)}`)
    try {
      const r = await fetch(`${BASE}/api/announcements`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) return true
    } catch { /* 还没起来 */ }
    await sleep(400)
  }
  throw new Error(`应用 40s 内未就绪：\n${appLogs.join('').slice(-800)}`)
}

/**
 * 对外入口：挑空闲端口 → 起应用；**只有证据是「端口被占」时才换端口重试**
 * （其它错误立刻抛，不空转 attempts 次）。
 */
async function startApp() {
  return startWithFreePort(async (port) => {
    try {
      return await startOnce(port)
    } catch (e) {
      await stopApp()   // 失败那次若还活着（就绪超时路径）先收掉，免得占着旧端口干扰下一次
      throw e
    }
  }, {
    attempts: 5,
    onRetry: ({ attempt, port, nextPort, error }) => {
      console.error(`  ↻ 第 ${attempt} 次起应用失败（端口 ${port} 被占），换端口重试 → ${nextPort}`)
      console.error(`     ${String(error?.message || error).split('\n')[0].slice(0, 160)}`)
    },
  })
}
async function stopApp() {
  if (!appProcess) return
  const proc = appProcess
  appProcess = null
  proc.kill('SIGTERM')
  await sleep(400)
  if (!proc.killed) proc.kill('SIGKILL')
}
function disableRegisterChallenge() {
  const db = openDb()
  try {
    db.prepare(
      "INSERT INTO system_config(key,value) VALUES('register_turnstile_enabled','false') "
      + "ON CONFLICT(key) DO UPDATE SET value='false'",
    ).run()
  } finally { db.close() }
}

/** 直接入库造评测：绕开 Turnstile（游客通道 fail-closed，脚本拿不到真实令牌） */
function seedGuestReview({ id, dealId, nickname, rating, content, status, fingerprint, ipHash, qqCipher, userId }) {
  const db = openDb()
  try {
    const now = Date.now()
    db.prepare(`
      INSERT INTO token_deal_guest_reviews
        (id, deal_id, user_id, nickname, qq_cipher, rating, content, status, reject_reason,
         reviewer_id, ip_hash, fingerprint, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?, ?)
    `).run(id, dealId, userId ?? null, nickname, qqCipher ?? '', rating, content, status, ipHash, fingerprint, now, now)
  } finally { db.close() }
}

function readGuestReviewRow(id) {
  const db = openDb()
  try {
    return db.prepare('SELECT * FROM token_deal_guest_reviews WHERE id = ?').get(id)
  } finally { db.close() }
}

/** 造一条**登录用户**评测（token_deal_reviews）—— 让「合并评测列表」有内容，
 *  否则「删除后合并列表不含它」会在空列表上假通过 */
function seedUserReview({ dealId, username, rating, content }) {
  const db = openDb()
  try {
    const now = Date.now()
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (!u) throw new Error(`用户 ${username} 不存在，无法造登录用户评测`)
    db.prepare(`
      INSERT INTO token_deal_reviews (deal_id, user_id, rating, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(dealId, u.id, rating, content, now, now)
  } finally { db.close() }
}
function readDealRating(dealId) {
  const db = openDb()
  try {
    return db.prepare('SELECT rating_sum, rating_count FROM token_deals WHERE id = ?').get(dealId)
  } finally { db.close() }
}

// 哨兵：这些值只要出现在响应体里，就说明内部字段被下发了
const FP_SENTINEL = 'FPSENTINELaaaa1111bbbb2222cccc'
const IP_SENTINEL = 'IPSENTINELdddd3333eeee4444ffff'
const QQ_PLAIN = '123456789'

/** 响应体/HTML 里出现任一敏感键名或哨兵值 → 视为泄露 */
function scanLeak(raw) {
  const hits = []
  // 按线上真实列名检查（2026-10-30 lead 从生产库快照核实）：
  //   fingerprint（208/208 非空）、ip_hash（20 行非空）、qq_cipher、内部 id（user_id / reviewer_id）
  // 注：guest_fingerprint 是**通告表**的叫法，一并挡着以防串表
  for (const k of ['fingerprint', 'guest_fingerprint', 'ip_hash', 'qq_cipher', 'user_id', 'reviewer_id', 'deleted_status']) {
    if (new RegExp(`"${k}"\\s*:`).test(raw)) hits.push(`键名 ${k}`)
  }
  if (raw.includes(FP_SENTINEL)) hits.push('指纹哨兵值')
  if (raw.includes(IP_SENTINEL)) hits.push('IP 哨兵值')
  if (raw.includes(QQ_PLAIN)) hits.push('明文 QQ')
  return hits
}

/** 「不包含」类断言的前置条件钉子：先证明集合**非空**，否则 every/some 会在空集上假通过 */
function nonEmpty(desc, arr, extra = '') {
  check(`${desc}（非空前提 · 防空集假通过）`, Array.isArray(arr) && arr.length > 0, extra || JSON.stringify(arr))
}

// ── 主流程 ──────────────────────────────────────────────────
async function main() {
  console.log(`\n▶ 启动应用（运行时选空闲端口，db=${DB_PATH}）`)
  ensureNativeModule()
  await startApp()
  disableRegisterChallenge()
  ok('应用已就绪')

  // ── 账号准备 ──
  await api('/api/auth/register', { method: 'POST', body: { username: ADMIN_USER, password: PASSWORD } })
  await api('/api/auth/register', { method: 'POST', body: { username: 'alice', password: PASSWORD } })
  const adminLogin = await api('/api/auth/login', { method: 'POST', body: { username: ADMIN_USER, password: PASSWORD } })
  const admin = cookieFrom(adminLogin.res)
  const aliceLogin = await api('/api/auth/login', { method: 'POST', body: { username: 'alice', password: PASSWORD } })
  const alice = cookieFrom(aliceLogin.res)
  check('管理员登录拿到 Cookie', !!admin, `status=${adminLogin.status}`)
  check('普通用户登录拿到 Cookie', !!alice, `status=${aliceLogin.status}`)

  // ── 准备通告 + 三条评测（三态各一）──
  const created = await api('/api/token-deals', {
    method: 'POST',
    cookie: admin,
    body: {
      provider: 'E2E', url: 'https://example.com/join', call_url: 'https://example.com/v1',
      quota: '免费', models: ['e2e-model'], region: 'cn', quality: '中品',
      source_tag: 'official', category: 'token', note: '管理端游客评测自测',
      title: 'E2E 游客评测通告',
    },
  })
  const dealId = created.json?.deal_id || created.json?.data?.id || created.json?.deal?.id
  check('创建通告成功（拿到 deal_id）', !!dealId, JSON.stringify(created.json)?.slice(0, 200))
  if (!dealId) throw new Error('无法创建通告，终止')

  const ID_APPROVED = `gr_e2e_approved_${Date.now()}`
  const ID_PENDING = `gr_e2e_pending_${Date.now()}`
  const ID_REJECTED = `gr_e2e_rejected_${Date.now()}`

  seedGuestReview({
    id: ID_APPROVED, dealId, nickname: '已通过游客', rating: 5,
    content: 'E2E 已通过评测正文（删除后不应出现在公开列表）', status: 'approved',
    fingerprint: FP_SENTINEL, ipHash: IP_SENTINEL, qqCipher: '', userId: null,
  })
  seedGuestReview({
    id: ID_PENDING, dealId, nickname: '待审游客', rating: 3,
    content: 'E2E 待审评测正文', status: 'pending',
    fingerprint: 'FPSENTINEL-pending', ipHash: 'IPSENTINEL-pending', userId: null,
  })
  seedGuestReview({
    id: ID_REJECTED, dealId, nickname: '已拒绝游客', rating: 2,
    content: 'E2E 已拒绝评测正文', status: 'rejected',
    fingerprint: 'FPSENTINEL-rejected', ipHash: 'IPSENTINEL-rejected', userId: 999,
  })

  // 清掉本通告上的种子评测，让断言只针对本次造的三条（种子数据会随机灌入演示评测）
  {
    const db = openDb()
    try {
      db.prepare("DELETE FROM token_deal_guest_reviews WHERE deal_id = ? AND id LIKE 'gr_seed_%'").run(dealId)
      db.prepare('DELETE FROM token_deal_reviews WHERE deal_id = ?').run(dealId)
    } finally { db.close() }
  }
  // 一条登录用户评测：保证「合并评测列表」非空（否则相关「不包含」断言会在空集上假通过）
  seedUserReview({ dealId, username: 'alice', rating: 4, content: 'E2E 登录用户评测正文（用于非空前提）' })
  {
    const db = openDb()
    try {
      // 按「仅 approved 计入」重算一次，使下面的评分增量断言有确定基准。
      // 谓词与 token-deals.ts 的 syncDealCounters 逐字一致（只判 status='approved'，不判 deleted_at）：
      // ① 那才是应用真实的计数口径；② 此刻软删除三列还不存在（由管理端入口惰性补），
      //    这里如果引用 g.deleted_at 会直接 no such column —— 顺手复现了本次修的那个 500 的成因。
      db.prepare(`
        UPDATE token_deals SET
          rating_sum = (SELECT COALESCE(SUM(rating),0) FROM token_deal_reviews WHERE deal_id = ?)
            + (SELECT COALESCE(SUM(g.rating),0) FROM token_deal_guest_reviews g WHERE g.deal_id = ? AND g.status = 'approved'),
          rating_count = (SELECT COUNT(*) FROM token_deal_reviews WHERE deal_id = ?)
            + (SELECT COUNT(*) FROM token_deal_guest_reviews g WHERE g.deal_id = ? AND g.status = 'approved')
        WHERE id = ?
      `).run(dealId, dealId, dealId, dealId, dealId)
    } finally { db.close() }
  }
  ok('已写入三条评测（approved / pending / rejected）并清理种子评测')

  // ═══ 现状复现：改动前管理员到底能不能删 ═══
  //
  // 用户原话「管理员无法删除游客的评测」。用**既有端点**把现状钉死，避免只凭读代码下结论：
  //   1. 唯一的删除入口是「游客撤回自己的待审评测」，它对已通过评测一律 409 —— 管理员也一样；
  //   2. 该入口是**物理删除**且无审计，即使删得掉也留不下痕；
  //   3. 管理端只有「待审队列」（仅 status='pending'），已通过/已拒绝的评测在后台根本看不到；
  //   4. 既有审核端点只认 approve/reject，没有删除动作。
  console.log('\n▶ 现状复现（改动前的行为，作为回归基线）')
  {
    // ★ 全新库上**先打既有只读端点**：这一条是本次真正修过的回归 ——
    // 给既有待审队列的 SQL 加了 deleted_at 过滤、却漏了确保该列存在时，
    // 全新库第一次访问就是 500 `no such column: g.deleted_at`
    // （已有库因为管理员先访问过新列表页而补过列，所以本地「看起来是好的」）。
    // 因此这里的顺序**必须**保持：这些调用要发生在本脚本任何管理端调用之前。
    for (const [name, path] of [
      ['既有待审队列 /api/guest-reviews', '/api/guest-reviews'],
      ['公开游客评测列表', `/api/token-deals/${dealId}/guest-reviews`],
      ['合并评测列表', `/api/token-deals/${dealId}/reviews`],
      ['通告详情', `/api/token-deals/${dealId}`],
    ]) {
      const r = await api(path, { cookie: admin })
      check(`★ 全新库上 ${name} 不报 500（列惰性补齐未漏调）`, r.status !== 500,
        `status=${r.status} ${r.text.slice(0, 120)}`)
    }

    const legacyDel = await api(`/api/token-deals/${dealId}/guest-reviews/${ID_APPROVED}`, {
      method: 'DELETE', cookie: admin,
    })
    check('① 既有撤回端点：管理员删已通过评测 → 409（删不掉）', legacyDel.status === 409,
      `status=${legacyDel.status} body=${legacyDel.text.slice(0, 160)}`)
    check('① 提示文案表明只允许待审', String(legacyDel.json?.error || '').includes('待审核'),
      String(legacyDel.json?.error))
    check('① 库里该行未被改动（deleted_at 仍空）', !readGuestReviewRow(ID_APPROVED)?.deleted_at)

    const legacyPending = await api(`/api/token-deals/${dealId}/guest-reviews/${ID_PENDING}`, {
      method: 'DELETE', cookie: admin,
    })
    check('② 且该入口是**物理删除**（对 pending 直接删行，无 deleted_at 可留痕）',
      legacyPending.status === 200 && readGuestReviewRow(ID_PENDING) === undefined,
      `status=${legacyPending.status} rowAfter=${JSON.stringify(readGuestReviewRow(ID_PENDING))}`)
    // 补回被物理删掉的那条，后续用例仍需要它
    seedGuestReview({
      id: ID_PENDING, dealId, nickname: '待审游客', rating: 3,
      content: 'E2E 待审评测正文', status: 'pending',
      fingerprint: 'FPSENTINEL-pending', ipHash: 'IPSENTINEL-pending', userId: null,
    })
    ok('② 已补回被物理删除的待审评测，供后续用例使用')

    const queue = await api('/api/guest-reviews?limit=100', { cookie: admin })
    const qIds = (queue.json?.reviews || []).map(r => r.id)
    check('③ 既有管理端「待审队列」只含 pending', !!qIds.length && !qIds.includes(ID_APPROVED) && !qIds.includes(ID_REJECTED),
      `ids=${qIds.join(',')}`)
    check('③ 已通过的评测在既有管理端列表里完全不可见（列表缺失）',
      !queue.text.includes('E2E 已通过评测正文'))

    const legacyAction = await api(`/api/guest-reviews/${ID_APPROVED}/review`, {
      method: 'POST', cookie: admin, body: { action: 'delete' },
    })
    check('④ 既有审核端点不支持 delete（只有 approve/reject）→ 400', legacyAction.status === 400,
      `status=${legacyAction.status} body=${legacyAction.text.slice(0, 160)}`)
    check('④ 结论：管理员删除能力缺失（缺删除接口 + 缺列表），不是权限判断把管理员挡了 ——'
      + ' 权限侧 withdrawGuestReview 对管理员本就有 isAdmin 旁路，真正拦人的是 `status !== pending` 这道状态闸',
      legacyDel.status === 409 && legacyAction.status === 400)
  }

  // ═══ ⓐ 未登录 → 401 ═══
  console.log('\n▶ ⓐ 未登录访问管理端列表 → 401')
  {
    const r = await api('/api/admin/guest-reviews')
    check('未登录 GET 列表 → 401', r.status === 401, `status=${r.status} ${r.text.slice(0, 120)}`)
    check('401 响应不含任何评测正文', !r.text.includes('E2E 已通过评测正文'))
    const d = await api(`/api/admin/guest-reviews/${ID_APPROVED}`, { method: 'DELETE' })
    check('未登录 DELETE → 401', d.status === 401, `status=${d.status}`)
    const a = await api(`/api/admin/guest-reviews/${ID_APPROVED}/action`, { method: 'POST', body: { action: 'delete' } })
    check('未登录 POST action → 401', a.status === 401, `status=${a.status}`)
    const au = await api(`/api/admin/guest-reviews/audit?id=${ID_APPROVED}`)
    check('未登录 GET 审计 → 401', au.status === 401, `status=${au.status}`)
  }

  // ═══ ⓑ 非管理员 → 403 ═══
  console.log('\n▶ ⓑ 普通登录用户 → 403')
  {
    const r = await api('/api/admin/guest-reviews', { cookie: alice })
    check('普通用户 GET 列表 → 403', r.status === 403, `status=${r.status} ${r.text.slice(0, 120)}`)
    check('403 响应不含评测正文', !r.text.includes('E2E 已通过评测正文'), r.text.slice(0, 160))
    const d = await api(`/api/admin/guest-reviews/${ID_APPROVED}`, { method: 'DELETE', cookie: alice })
    check('普通用户 DELETE → 403', d.status === 403, `status=${d.status}`)
    const row = readGuestReviewRow(ID_APPROVED)
    check('越权删除未生效（deleted_at 仍为空）', !row?.deleted_at, JSON.stringify(row?.deleted_at))
    // 顺带确认既有「游客撤回」端点不会成为管理员删除的旁路：已通过评测仍不可撤回
    const legacy = await api(`/api/token-deals/${dealId}/guest-reviews/${ID_APPROVED}`, { method: 'DELETE', cookie: admin })
    check('既有撤回端点对已通过评测仍返回 409（未被本改动放开）', legacy.status === 409, `status=${legacy.status}`)
  }

  // ═══ ⓒ 管理员可见 + 敏感字段不外泄 ═══
  console.log('\n▶ ⓒ 管理员可见列表 + 脱敏')
  {
    const r = await api(`/api/admin/guest-reviews?deal_id=${dealId}&limit=100`, { cookie: admin })
    check('管理员 GET 列表 → 200', r.status === 200, `status=${r.status}`)
    const rows = r.json?.reviews || []
    const ids = rows.map(x => x.id)
    check('列表含三条评测', ids.includes(ID_APPROVED) && ids.includes(ID_PENDING) && ids.includes(ID_REJECTED),
      `ids=${ids.join(',')}`)
    check('返回 scope=all', r.json?.scope === 'all', String(r.json?.scope))
    check('total 与行数一致', r.json?.total === rows.length, `total=${r.json?.total} rows=${rows.length}`)

    const approvedRow = rows.find(x => x.id === ID_APPROVED)
    check('行内含评测内容', approvedRow?.content?.includes('E2E 已通过评测正文'))
    check('行内含游客展示名', approvedRow?.nickname === '已通过游客', String(approvedRow?.nickname))
    check('行内含所属通告信息', approvedRow?.deal?.id === dealId, JSON.stringify(approvedRow?.deal))
    check('行内含四态 display_status', approvedRow?.display_status === 'approved', String(approvedRow?.display_status))
    check('行内含删除标记字段（未删 = null）', approvedRow?.deleted_at === null, JSON.stringify(approvedRow?.deleted_at))

    const hits = scanLeak(r.text)
    check('★ 列表响应不含 fingerprint / ip_hash / qq_cipher / user_id / 哨兵值', hits.length === 0, hits.join('；'))
    check('★ 列表响应不含明文 QQ', !r.text.includes(QQ_PLAIN))

    // user_id=999 的那条：只能看到 is_user=true，看不到账号 id
    const rejectedRow = rows.find(x => x.id === ID_REJECTED)
    check('登录用户提交的评测只暴露 is_user 布尔', rejectedRow?.is_user === true && !('user_id' in (rejectedRow || {})),
      JSON.stringify({ is_user: rejectedRow?.is_user, hasUserId: 'user_id' in (rejectedRow || {}) }))
    check('响应里搜不到账号 id 999 作为独立值', !/"user_id"\s*:\s*999/.test(r.text))

    check('counts 四态齐全', ['all', 'pending', 'approved', 'rejected', 'deleted'].every(k => typeof r.json?.counts?.[k] === 'number'),
      JSON.stringify(r.json?.counts))
    check('counts.pending ≥ 1', (r.json?.counts?.pending || 0) >= 1, String(r.json?.counts?.pending))
  }

  // 筛选 / 分页
  console.log('\n▶ 筛选与分页')
  {
    const p = await api(`/api/admin/guest-reviews?deal_id=${dealId}&status=pending`, { cookie: admin })
    const ids = (p.json?.reviews || []).map(x => x.id)
    check('status=pending 只返回待审', ids.length === 1 && ids[0] === ID_PENDING, `ids=${ids.join(',')}`)

    const k = await api(`/api/admin/guest-reviews?deal_id=${dealId}&keyword=${encodeURIComponent('已拒绝评测正文')}`, { cookie: admin })
    const kids = (k.json?.reviews || []).map(x => x.id)
    check('keyword 命中评测内容', kids.length === 1 && kids[0] === ID_REJECTED, `ids=${kids.join(',')}`)

    const k2 = await api(`/api/admin/guest-reviews?deal_id=${dealId}&keyword=${encodeURIComponent('待审游客')}`, { cookie: admin })
    check('keyword 命中游客展示名', (k2.json?.reviews || []).some(x => x.id === ID_PENDING), k2.text.slice(0, 120))

    const pg = await api(`/api/admin/guest-reviews?deal_id=${dealId}&limit=2&page=2`, { cookie: admin })
    check('分页 page=2 生效（3 条 → 第 2 页 1 条）',
      (pg.json?.reviews || []).length === 1 && pg.json?.page === 2, `rows=${(pg.json?.reviews || []).length} page=${pg.json?.page}`)

    const bad = await api(`/api/admin/guest-reviews?status=__nope__&deal_id=${dealId}`, { cookie: admin })
    check('非法 status 退化为 all（不 500）', bad.status === 200, `status=${bad.status}`)
  }

  // ── 真分页：生产库 208 行，绝不能一次全塞进响应 ──
  console.log('\n▶ 真分页（造 25 行，验证 LIMIT/OFFSET 切片）')
  {
    const MARK = `PAGEMARK${Date.now()}`
    const ids = []
    for (let i = 0; i < 25; i++) {
      const id = `gr_e2e_page_${i}_${Date.now()}`
      ids.push(id)
      seedGuestReview({
        id, dealId, nickname: `分页游客${i}`, rating: (i % 5) + 1,
        content: `${MARK} 第 ${i} 条分页用例正文`, status: 'pending',
        fingerprint: `FPSENTINEL-page-${i}`, ipHash: `IPSENTINEL-page-${i}`, userId: null,
      })
    }
    const q = `deal_id=${dealId}&keyword=${MARK}`
    const p1 = await api(`/api/admin/guest-reviews?${q}&limit=10&page=1`, { cookie: admin })
    const p2 = await api(`/api/admin/guest-reviews?${q}&limit=10&page=2`, { cookie: admin })
    const p3 = await api(`/api/admin/guest-reviews?${q}&limit=10&page=3`, { cookie: admin })
    check('★ 命中 25 行，total 反映全量', p1.json?.total === 25, `total=${p1.json?.total}`)
    check('★ limit=10 时单页只回 10 行（不是全量）', (p1.json?.reviews || []).length === 10,
      `rows=${(p1.json?.reviews || []).length}`)
    check('第 2 页 10 行 / 第 3 页 5 行', (p2.json?.reviews || []).length === 10 && (p3.json?.reviews || []).length === 5,
      `p2=${(p2.json?.reviews || []).length} p3=${(p3.json?.reviews || []).length}`)
    const seen = new Set()
    let dup = 0
    for (const r of [...(p1.json?.reviews || []), ...(p2.json?.reviews || []), ...(p3.json?.reviews || [])]) {
      if (seen.has(r.id)) dup++
      seen.add(r.id)
    }
    check('★ 三页无重复、并集覆盖全部 25 行（OFFSET 真的生效）', dup === 0 && seen.size === 25,
      `dup=${dup} uniq=${seen.size}`)
    check('分页响应同样无敏感字段', scanLeak(p1.text).length === 0, scanLeak(p1.text).join('；'))

    // 清理：这 25 行只是分页用例，删掉以免污染后续计数断言
    const db = openDb()
    try {
      db.prepare("DELETE FROM token_deal_guest_reviews WHERE content LIKE ?").run(`${MARK}%`)
    } finally { db.close() }
    ok('分页用例数据已清理')
  }

  // ═══ ⓓ + ⓔ 删除 ═══
  console.log('\n▶ ⓓ 管理员删除已通过评测 → 公开侧消失')
  const ratingBefore = readDealRating(dealId)
  {
    const pubBefore = await api(`/api/token-deals/${dealId}/guest-reviews?limit=50`)
    nonEmpty('删除前公开列表', pubBefore.json?.reviews)
    check('删除前：公开列表含该评测',
      (pubBefore.json?.reviews || []).some(x => x.id === ID_APPROVED), pubBefore.text.slice(0, 160))
    check('删除前：公开列表不含待审评测',
      !(pubBefore.json?.reviews || []).some(x => x.id === ID_PENDING))
    // 公开侧不得出现内部字段（回归守卫）
    const pubHits = scanLeak(pubBefore.text)
    check('★ 公开列表本来就无敏感字段', pubHits.length === 0, pubHits.join('；'))
  }

  const del = await api(`/api/admin/guest-reviews/${ID_APPROVED}?reason=${encodeURIComponent('E2E 违规内容')}`, {
    method: 'DELETE', cookie: admin,
  })
  check('管理员 DELETE → 200', del.status === 200, `status=${del.status} ${del.text.slice(0, 200)}`)
  check('删除响应 message 提示已移除并重算评分',
    String(del.json?.message || '').includes('已删除'), String(del.json?.message))
  check('删除响应本身也不含敏感字段', scanLeak(del.text).length === 0, scanLeak(del.text).join('；'))

  {
    const pubAfter = await api(`/api/token-deals/${dealId}/guest-reviews?limit=50`)
    check('★ 删除后：公开列表不再含该评测',
      !(pubAfter.json?.reviews || []).some(x => x.id === ID_APPROVED), JSON.stringify((pubAfter.json?.reviews || []).map(x => x.id)))
    check('删除后：公开列表条数减少', ((pubAfter.json?.total) || 0) === 0, `total=${pubAfter.json?.total}`)

    const merged = await api(`/api/token-deals/${dealId}/reviews?limit=50`)
    nonEmpty('合并评测列表', merged.json?.reviews)
    check('★ 删除后：合并评测列表也不含它',
      !merged.text.includes('E2E 已通过评测正文'), merged.text.slice(0, 200))

    const ratingAfter = readDealRating(dealId)
    check('★ 删除后通告评分已重算（rating_count 减 1）',
      (ratingBefore?.rating_count || 0) - (ratingAfter?.rating_count || 0) === 1,
      `before=${JSON.stringify(ratingBefore)} after=${JSON.stringify(ratingAfter)}`)
    check('★ 删除后评分总分同步减少（5 → 0）',
      (ratingBefore?.rating_sum || 0) - (ratingAfter?.rating_sum || 0) === 5,
      `before=${ratingBefore?.rating_sum} after=${ratingAfter?.rating_sum}`)

    const list = await api(`/api/admin/guest-reviews?deal_id=${dealId}&status=deleted`, { cookie: admin })
    const row = (list.json?.reviews || []).find(x => x.id === ID_APPROVED)
    check('★ 管理端 status=deleted 里能看到它', !!row, JSON.stringify((list.json?.reviews || []).map(x => x.id)))
    check('★ 该行 display_status=deleted', row?.display_status === 'deleted', String(row?.display_status))
    check('该行 deleted_at 非空且带原因标记',
      !!row?.deleted_at && String(row?.reject_reason || '').includes('管理员删除'),
      JSON.stringify({ deleted_at: row?.deleted_at, reason: row?.reject_reason }))
    check('该行内容仍可读（管理员要能看清删的是什么）', String(row?.content || '').includes('E2E 已通过评测正文'))
  }

  console.log('\n▶ ⓔ 软删除核实（库里行仍在）')
  {
    const row = readGuestReviewRow(ID_APPROVED)
    check('★ 库里行仍存在（不是物理删除）', !!row, 'row 为 undefined')
    check('★ deleted_at 非空', !!row?.deleted_at, JSON.stringify(row?.deleted_at))
    check('★ deleted_by 记录为操作者 id', !!row?.deleted_by && Number(row.deleted_by) > 0, String(row?.deleted_by))
    check('★ deleted_status 保留删除前状态（=approved）', row?.deleted_status === 'approved', String(row?.deleted_status))
    check('★ status 已降为 rejected（使评分计数不再计入）', row?.status === 'rejected', String(row?.status))

    const db = openDb()
    let audit = []
    try {
      audit = db.prepare('SELECT * FROM guest_review_admin_actions WHERE review_id = ? ORDER BY id').all(ID_APPROVED)
    } finally { db.close() }
    check('★ 处置审计已落库（1 条 delete）', audit.length === 1 && audit[0].action === 'delete',
      JSON.stringify(audit.map(a => ({ action: a.action, from: a.from_status, to: a.to_status }))))
    check('★ 审计记录操作人用户名', audit[0]?.actor_name === ADMIN_USER, String(audit[0]?.actor_name))
    check('★ 审计记录前后状态 approved→rejected',
      audit[0]?.from_status === 'approved' && audit[0]?.to_status === 'rejected',
      JSON.stringify({ from: audit[0]?.from_status, to: audit[0]?.to_status }))
    check('★ 审计记录删除理由', String(audit[0]?.reason || '').includes('E2E 违规内容'), String(audit[0]?.reason))

    const au = await api(`/api/admin/guest-reviews/audit?id=${ID_APPROVED}`, { cookie: admin })
    check('管理员可读该评测的处置记录 → 200', au.status === 200, `status=${au.status}`)
    check('处置记录含 delete 动作与中文标签',
      (au.json?.actions || []).some(a => a.action === 'delete' && a.action_label === '删除'),
      JSON.stringify(au.json?.actions)?.slice(0, 200))
    check('★ 处置记录不含游客敏感字段', scanLeak(au.text).length === 0, scanLeak(au.text).join('；'))
  }

  // 幂等重删
  console.log('\n▶ 幂等与冲突')
  {
    const again = await api(`/api/admin/guest-reviews/${ID_APPROVED}`, { method: 'DELETE', cookie: admin })
    check('重复删除 → 200 且提示此前已删除', again.status === 200 && String(again.json?.message || '').includes('此前'),
      `status=${again.status} msg=${again.json?.message}`)
    const db = openDb()
    let n = 0
    try {
      n = db.prepare('SELECT COUNT(*) AS c FROM guest_review_admin_actions WHERE review_id = ?').get(ID_APPROVED).c
    } finally { db.close() }
    check('重复删除不产生重复审计行', n === 1, `审计行数=${n}`)

    const missing = await api('/api/admin/guest-reviews/gr___not_exist__', { method: 'DELETE', cookie: admin })
    check('删除不存在的评测 → 404', missing.status === 404, `status=${missing.status}`)

    const noAction = await api(`/api/admin/guest-reviews/${ID_PENDING}/action`, { method: 'POST', cookie: admin, body: {} })
    check('缺少 action → 400', noAction.status === 400, `status=${noAction.status}`)
    const badAction = await api(`/api/admin/guest-reviews/${ID_PENDING}/action`, {
      method: 'POST', cookie: admin, body: { action: 'nuke' },
    })
    check('非法 action → 400', badAction.status === 400, `status=${badAction.status}`)

    const conflict = await api(`/api/admin/guest-reviews/${ID_REJECTED}/action`, {
      method: 'POST', cookie: admin, body: { action: 'approve' },
    })
    check('对非 pending 的评测 approve → 409', conflict.status === 409, `status=${conflict.status}`)
  }

  // 通过 / 拒绝 / 恢复
  console.log('\n▶ 通过 / 拒绝 / 恢复')
  {
    const approve = await api(`/api/admin/guest-reviews/${ID_PENDING}/action`, {
      method: 'POST', cookie: admin, body: { action: 'approve' },
    })
    check('管理员通过待审评测 → 200', approve.status === 200, `status=${approve.status} ${approve.text.slice(0, 160)}`)
    check('通过后 status=approved 且计入评分', approve.json?.review?.status === 'approved', String(approve.json?.review?.status))
    const pub = await api(`/api/token-deals/${dealId}/guest-reviews?limit=50`)
    check('★ 通过后出现在公开列表', (pub.json?.reviews || []).some(x => x.id === ID_PENDING), pub.text.slice(0, 160))

    const ratingPreRestore = readDealRating(dealId)
    const restore = await api(`/api/admin/guest-reviews/${ID_APPROVED}/action`, {
      method: 'POST', cookie: admin, body: { action: 'restore' },
    })
    check('恢复已删除评测 → 200', restore.status === 200, `status=${restore.status}`)
    check('恢复后 deleted_at 清空', restore.json?.review?.deleted_at === null, JSON.stringify(restore.json?.review?.deleted_at))
    check('★ 恢复后回到删除前状态 approved（不是 pending）',
      restore.json?.review?.status === 'approved' && restore.json?.review?.display_status === 'approved',
      JSON.stringify({ s: restore.json?.review?.status, d: restore.json?.review?.display_status }))
    const pub2 = await api(`/api/token-deals/${dealId}/guest-reviews?limit=50`)
    check('★ 恢复后重新出现在公开列表', (pub2.json?.reviews || []).some(x => x.id === ID_APPROVED), pub2.text.slice(0, 160))
    const ratingBack = readDealRating(dealId)
    check('★ 恢复后评分计数 +1 并回到删除前水平',
      (ratingBack?.rating_count || 0) === (ratingPreRestore?.rating_count || 0) + 1
      && (ratingBack?.rating_sum || 0) === (ratingPreRestore?.rating_sum || 0) + 5,
      `pre=${JSON.stringify(ratingPreRestore)} now=${JSON.stringify(ratingBack)}`)
    const db = openDb()
    let acts = []
    try {
      acts = db.prepare('SELECT action FROM guest_review_admin_actions WHERE review_id = ? ORDER BY id').all(ID_APPROVED)
    } finally { db.close() }
    check('★ 审计链完整（delete → restore）', acts.map(a => a.action).join(',') === 'delete,restore',
      acts.map(a => a.action).join(','))

    // 删除待审评测（非 approved）：不应影响评分
    const beforePending = readDealRating(dealId)
    const delPending = await api(`/api/admin/guest-reviews/${ID_REJECTED}`, { method: 'DELETE', cookie: admin })
    check('删除 rejected 评测 → 200', delPending.status === 200, `status=${delPending.status}`)
    const afterPending = readDealRating(dealId)
    check('删除非 approved 评测不改动评分',
      (beforePending?.rating_count || 0) === (afterPending?.rating_count || 0),
      `before=${beforePending?.rating_count} after=${afterPending?.rating_count}`)
  }

  // ── 页面可达性 + HTML 脱敏 ──
  console.log('\n▶ 页面可达性与 HTML 脱敏')
  {
    const page = await api('/admin/guest-reviews', { cookie: admin })
    check('管理员访问 /admin/guest-reviews → 200', page.status === 200, `status=${page.status}`)
    check('页面 HTML 含页面标题「游客评测」', page.text.includes('游客评测'))
    check('★ 页面 HTML 不含敏感字段名', scanLeak(page.text).length === 0, scanLeak(page.text).join('；'))

    const anon = await api('/admin/guest-reviews')
    check('未登录访问页面被重定向登录', [200, 302, 307].includes(anon.status), `status=${anon.status}`)
    if (anon.status >= 300) {
      check('重定向目标是登录页', String(anon.res.headers.get('location') || '').includes('/login'),
        String(anon.res.headers.get('location')))
    }
    // 入口链接：**不能**用 SSR HTML 断言 —— /admin 的快捷操作卡片都带 v-if="isAdmin"，
    // 而 auth store 在 SSR 时还没水合（实测 /admin/users、/admin/config 同样不在 SSR HTML 里），
    // 所以这里改为「源码 + 构建产物」双断言：源码里有入口，客户端包里也真的带上了这条路由。
    const dashSrc = readFileSync(join(ROOT, 'pages', 'admin', 'index.vue'), 'utf8')
    check('仪表盘源码含「游客评测」入口链接', dashSrc.includes('to="/admin/guest-reviews"'))
    const nuxtDir = join(ROOT, '.output', 'public', '_nuxt')
    const bundled = existsSync(nuxtDir)
      && readdirSync(nuxtDir).filter(f => f.endsWith('.js'))
        .some(f => readFileSync(join(nuxtDir, f), 'utf8').includes('admin/guest-reviews'))
    check('客户端构建产物里带上该入口路由', bundled)
  }

  // ── 回归：既有「待审队列」与「审核」端点必须与新软删除口径一致 ──
  console.log('\n▶ 回归：既有待审队列 / 审核端点不被软删除行污染')
  {
    // 造一条全新的待审评测（ID_PENDING 在前面已被通过，队列里本来就没有它）
    const ID_PENDING2 = `gr_e2e_queue_${Date.now()}`
    seedGuestReview({
      id: ID_PENDING2, dealId, nickname: '队列待审游客', rating: 4,
      content: 'E2E 队列回归评测正文', status: 'pending',
      fingerprint: 'FPSENTINEL-queue', ipHash: 'IPSENTINEL-queue', userId: null,
    })

    const queueBefore = await api('/api/guest-reviews?limit=100', { cookie: admin })
    check('既有待审队列端点可用 → 200', queueBefore.status === 200, `status=${queueBefore.status}`)
    const inQueue = (queueBefore.json?.reviews || []).some(r => r.id === ID_PENDING2)
    check('待审队列包含待审评测', inQueue, JSON.stringify((queueBefore.json?.reviews || []).map(r => r.id)))
    check('待审队列响应不含敏感字段', scanLeak(queueBefore.text).length === 0, scanLeak(queueBefore.text).join('；'))

    const delPending = await api(`/api/admin/guest-reviews/${ID_PENDING2}?reason=${encodeURIComponent('回归用例')}`, {
      method: 'DELETE', cookie: admin,
    })
    check('管理员软删除一条待审评测 → 200', delPending.status === 200, `status=${delPending.status}`)

    const queueAfter = await api('/api/guest-reviews?limit=100', { cookie: admin })
    check('★ 软删除后既有待审队列不再含它（changed: g.deleted_at IS NULL）',
      !(queueAfter.json?.reviews || []).some(r => r.id === ID_PENDING2),
      JSON.stringify((queueAfter.json?.reviews || []).map(r => r.id)))
    check('★ pending_total 随之下降',
      (queueAfter.json?.pending_total || 0) === (queueBefore.json?.pending_total || 0) - 1,
      `before=${queueBefore.json?.pending_total} after=${queueAfter.json?.pending_total}`)

    const legacyReview = await api(`/api/guest-reviews/${ID_PENDING2}/review`, {
      method: 'POST', cookie: admin, body: { action: 'approve' },
    })
    check('★ 既有审核端点对已删除评测返回 404（不能靠它绕过删除）',
      legacyReview.status === 404, `status=${legacyReview.status}`)
    const row = readGuestReviewRow(ID_PENDING2)
    check('该行仍是软删除态（deleted_at 非空、status 仍为 rejected）',
      !!row?.deleted_at && row?.status === 'rejected', JSON.stringify({ d: row?.deleted_at, s: row?.status }))

    const pubNow = await api(`/api/token-deals/${dealId}/guest-reviews?limit=50`)
    nonEmpty('本轮公开列表', pubNow.json?.reviews)
    check('公开列表仍有其它已通过评测（证明上面的「没有它」不是因为列表为空）',
      (pubNow.json?.reviews || []).some(r => r.id === ID_APPROVED),
      JSON.stringify((pubNow.json?.reviews || []).map(r => r.id)))
    check('公开列表也没有它', !(pubNow.json?.reviews || []).some(r => r.id === ID_PENDING2))
  }

  // ── 汇总 ──
  console.log(`\n${'═'.repeat(52)}`)
  console.log(`通过 ${passCount} / 失败 ${failCount}`)
  if (failures.length) {
    console.log('\n失败项:')
    failures.forEach(f => console.log('  -', f))
  } else {
    console.log('全部通过 ✓')
  }
}

main()
  .catch((e) => {
    console.error('\n自测异常:', e)
    failCount++
    failures.push(String(e?.message || e))
  })
  .finally(async () => {
    await stopApp()
    // 临时库连同 WAL 一并清掉（/tmp 里的东西不留在仓库里）
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(DB_PATH + suffix, { force: true }) } catch { /* ignore */ }
    }
    process.exit(failCount ? 1 : 0)
  })