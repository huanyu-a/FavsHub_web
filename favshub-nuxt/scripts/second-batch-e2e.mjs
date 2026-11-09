#!/usr/bin/env node
/**
 * second-batch-e2e.mjs — 第二批优化 端到端冒烟（自包含，node 直跑）
 *
 * 先决条件：`pnpm build` 已产出 `.output/`。
 *
 * 覆盖 2026-10-30 的四项改动：
 *   ① 公告三态（发布 / 待发布）+ 软删除：公开侧只见 published 且未删除，后台可见全部并可恢复
 *   ② 邀请码：多码按展现比例加权随机、每次只下发一个、达到复制阈值后消失、
 *      码池绝不出现在公开详情里、非作者非管理员无权读写
 *   ③ 备注：上限 2000、富文本经服务端白名单消毒（script/onerror 必须被剥掉）
 *   ④ 前端脱敏：公开详情不下发 username / verified_by / actor / user_id / deleted_by
 *      —— **管理员视角同样不下发**（这正是本次修的回归点）
 *   ⑤ 模型拉取：SSRF 防护（内网 / 元数据 / 非 http / 内嵌凭据 一律拒绝）
 *
 * 用法：node scripts/second-batch-e2e.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3218
const BASE = `http://127.0.0.1:${APP_PORT}`
const PASSWORD = 'E2ePassw0rd!2026'

let passCount = 0
let failCount = 0
const failures = []
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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
async function startApp(dbPath) {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 `pnpm build`'); process.exit(1) }
  ensureNativeModule()
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), NUXT_DB_PATH: dbPath, NUXT_ADMIN_USERS: 'e2eadmin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => { console.error(`  [app] ${String(d).trim().slice(0, 400)}`) })
  appProcess.on('exit', () => { appProcess = null })
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    try { const r = await fetch(`${BASE}/api/announcements`); if (r.ok) return } catch {}
    await sleep(500)
  }
  throw new Error('应用 30s 内未就绪')
}
// 需要清理的临时库文件（含 WAL/SHM 边车）。
// 放在模块级是因为 dbPath 是 main() 内的局部变量，而**异常路径也要能清**。
let cleanupTargets = []

/** 删掉临时库。成功和异常两条路径都必须调 —— 失败时更需要清，否则会一直攒。 */
async function cleanupDb() {
  try {
    const { rmSync } = await import('node:fs')
    for (const f of cleanupTargets) rmSync(f, { force: true })
    cleanupTargets = []
  } catch { /* 清不掉不影响测试结论 */ }
}

async function stopApp() {
  if (!appProcess) return
  const proc = appProcess; appProcess = null
  proc.kill('SIGTERM'); await sleep(300)
  if (!proc.killed) proc.kill('SIGKILL')
}

// ── 断言序列 ────────────────────────────────────────────────
async function main() {
  mkdirSync(join(ROOT, 'data'), { recursive: true })
  const dbPath = join(ROOT, 'data', `e2e-second-batch-${Date.now()}.db`)
  cleanupTargets = ['', '-wal', '-shm'].map((s) => dbPath + s)
  console.log(`▶ 启动应用（PORT=${APP_PORT}，db=${dbPath}）`)
  await startApp(dbPath)
  disableRegisterChallenge(dbPath)
  ok('应用已就绪')

  await api('/api/auth/register', { method: 'POST', body: { username: 'e2eadmin', password: PASSWORD } })
  await api('/api/auth/register', { method: 'POST', body: { username: 'alice', password: PASSWORD } })
  const adminLogin = await api('/api/auth/login', { method: 'POST', body: { username: 'e2eadmin', password: PASSWORD } })
  const admin = cookieFrom(adminLogin.res)
  const aliceLogin = await api('/api/auth/login', { method: 'POST', body: { username: 'alice', password: PASSWORD } })
  const alice = cookieFrom(aliceLogin.res)
  check('管理员登录拿到 Cookie', !!admin)
  check('普通用户登录拿到 Cookie', !!alice)

  // ═══ ⓪ sync 端点（2026-10-31 补：此前无任何测试覆盖）═══
  //
  // `GET /api/sync/bookmarks/full` 与 `/since` 在扩展里**没有调用者**
  // （下载走 `/api/bookmarks` + `/api/folders`），但它们是对外公开 API：
  // 有鉴权、有正确查询，`since` 那条还专门加过索引
  // （migrate.ts 的 `idx_bookmarks_updated_at`）。
  //
  // 状态是「能用、没人用、没测试」—— 这种最容易被后续重构悄悄改坏。
  // 这里只断言**契约**（鉴权 + 形状 + 增量语义），不锁具体账号的数据。
  {
    console.log('\n▶ ⓪ sync 端点契约（full / since）')

    const fullAnon = await api('/api/sync/bookmarks/full')
    const sinceAnon = await api('/api/sync/bookmarks/since?timestamp=0')
    check('sync/full 未登录 → 401', fullAnon.status === 401, `status=${fullAnon.status}`)
    check('sync/since 未登录 → 401', sinceAnon.status === 401, `status=${sinceAnon.status}`)

    const full = await api('/api/sync/bookmarks/full', { cookie: admin })
    check('sync/full 已登录 → 200', full.status === 200, `status=${full.status}`)
    check('sync/full 返回 { bookmarks, folders, timestamp }',
      Array.isArray(full.json?.bookmarks) && Array.isArray(full.json?.folders) && !!full.json?.timestamp,
      `keys=${Object.keys(full.json || {}).join(',')}`)

    const sinceFuture = await api('/api/sync/bookmarks/since?timestamp=9999999999999', { cookie: admin })
    check('sync/since 时间戳在未来 → 空结果',
      sinceFuture.status === 200
      && Array.isArray(sinceFuture.json?.bookmarks) && sinceFuture.json.bookmarks.length === 0
      && Array.isArray(sinceFuture.json?.folders) && sinceFuture.json.folders.length === 0,
      `status=${sinceFuture.status} n=${sinceFuture.json?.bookmarks?.length}`)

    const sincePast = await api('/api/sync/bookmarks/since?timestamp=0', { cookie: admin })
    check('sync/since 时间戳为 0 → 有结果且不多于 full',
      sincePast.status === 200
      && Array.isArray(sincePast.json?.bookmarks)
      && sincePast.json.bookmarks.length <= (full.json?.bookmarks?.length ?? 0),
      `since=${sincePast.json?.bookmarks?.length} full=${full.json?.bookmarks?.length}`)

    const sinceLabels = (sincePast.json?.bookmarks || []).map((b) => b.label)
    check('sync/since 不返回 label 为空的书签',
      sinceLabels.every((l) => l !== '' && l != null),
      `空 label 条数=${sinceLabels.filter((l) => l === '' || l == null).length}`)
  }

  // ═══ ① 公告三态 + 软删除 ═══
  console.log('\n▶ ① 公告三态 + 软删除')
  const pub = await api('/api/admin/announcements', {
    method: 'POST', cookie: admin,
    body: { title: 'E2E 已发布', content: '正文 **加粗**', content_type: 'markdown', status: 'published' },
  })
  const pubId = pub.json?.data?.id
  check('新建 published 公告 → 200', pub.status === 200 && !!pubId, `status=${pub.status}`)

  const pend = await api('/api/admin/announcements', {
    method: 'POST', cookie: admin,
    body: { title: 'E2E 待发布', content: '还没发', status: 'pending' },
  })
  const pendId = pend.json?.data?.id
  check('新建 pending 公告 → 200', pend.status === 200 && !!pendId, `status=${pend.status}`)
  check('pending 公告落库状态为 pending', pend.json?.data?.status === 'pending', `status=${pend.json?.data?.status}`)

  {
    const list = await api('/api/announcements')
    const ids = (list.json?.data || []).map(a => a.id)
    check('公开列表含 published 公告', ids.includes(pubId))
    check('公开列表不含 pending 公告', !ids.includes(pendId))
  }

  // 状态可来回切：已发布 → 待发布 → 前端消失
  await api(`/api/admin/announcements/${pubId}`, { method: 'PUT', cookie: admin, body: { status: 'pending' } })
  {
    const list = await api('/api/announcements')
    const ids = (list.json?.data || []).map(a => a.id)
    check('切为 pending 后公开列表消失', !ids.includes(pubId))
  }
  await api(`/api/admin/announcements/${pubId}`, { method: 'PUT', cookie: admin, body: { status: 'published' } })
  {
    const detail = await api(`/api/announcements/${pubId}`)
    check('切回 published 后公开详情可读 → 200', detail.status === 200, `status=${detail.status}`)
  }

  // 软删除
  const del = await api(`/api/admin/announcements/${pubId}`, { method: 'DELETE', cookie: admin })
  check('删除公告 → 200', del.status === 200, `status=${del.status}`)
  {
    const list = await api('/api/announcements')
    const ids = (list.json?.data || []).map(a => a.id)
    check('软删除后公开列表消失', !ids.includes(pubId))
    const detail = await api(`/api/announcements/${pubId}`)
    check('软删除后公开详情 404', detail.status === 404, `status=${detail.status}`)

    const adminList = await api('/api/admin/announcements', { cookie: admin })
    const row = (adminList.json?.data || []).find(a => a.id === pubId)
    check('后台列表仍可见已删除公告', !!row)
    check('后台列表带 deleted_at 标记', !!row?.deleted_at, JSON.stringify(row?.deleted_at))
    const filtered = await api('/api/admin/announcements?status=deleted', { cookie: admin })
    check('?status=deleted 只返回已删除',
      (filtered.json?.data || []).length > 0 && (filtered.json?.data || []).every(a => !!a.deleted_at))
  }

  // 恢复
  const restore = await api(`/api/admin/announcements/${pubId}`, { method: 'PUT', cookie: admin, body: { restore: true } })
  check('恢复公告 → 200', restore.status === 200, `status=${restore.status}`)
  check('恢复后 deleted_at 已清空', !restore.json?.data?.deleted_at, JSON.stringify(restore.json?.data?.deleted_at))
  {
    const detail = await api(`/api/announcements/${pubId}`)
    check('恢复后公开详情重新可读 → 200', detail.status === 200, `status=${detail.status}`)
  }
  {
    const anon = await api('/api/admin/announcements')
    check('未登录访问后台公告列表 → 401', anon.status === 401, `status=${anon.status}`)
  }

  // ═══ ② 邀请码 ═══
  console.log('\n▶ ② 邀请码：比例抽选 / 阈值截断 / 码池不外泄 / 凭证 / 权限')
  const dealBase = {
    provider: 'E2E', url: 'https://example.com/join',
    call_url: 'https://example.com/v1', quota: '免费', models: ['e2e-model'],
    region: 'cn', quality: '中品', source_tag: 'official', category: 'token',
    note: 'E2E 备注',
  }
  const createDeal = async (title) => {
    const r = await api('/api/token-deals', { method: 'POST', cookie: admin, body: { ...dealBase, title } })
    return r.json?.deal_id
  }

  const dealId = await createDeal('E2E 邀请码通告')
  check('创建通告 → 200 且有 deal_id', !!dealId, `body=${dealId}`)

  // 抽码限频是 60/h/IP/通告，所以「大量抽选」的用例分散到不同通告上，避免自撞限频
  const drawDeal = await createDeal('E2E 抽选分布通告')
  const rateDeal = await createDeal('E2E 限频通告')

  const put1 = await api(`/api/token-deals/${dealId}/invite-codes`, {
    method: 'PUT', cookie: admin,
    body: { codes: [
      { code: 'CODE-AAA', label: '甲', weight: 1, copyLimit: 0 },
      { code: 'CODE-BBB', label: '乙', weight: 1, copyLimit: 0 },
      { code: 'CODE-CCC', label: '丙', weight: 1, copyLimit: 0 },
    ] },
  })
  check('写入 3 个邀请码 → 200', put1.status === 200, `status=${put1.status} ${put1.text.slice(0, 160)}`)
  check('返回可用数 = 3', put1.json?.data?.available === 3, JSON.stringify(put1.json?.data))

  {
    // 详情接口不得泄露码池
    const d = await api(`/api/token-deals/${dealId}`)
    const raw = JSON.stringify(d.json)
    check('详情标记 has_invite_code=true', d.json?.deal?.has_invite_code === true)
    check('详情不含 invite_codes 数组字段', !('invite_codes' in (d.json?.deal || {})))
    check('详情响应里搜不到任何邀请码明文',
      !raw.includes('CODE-AAA') && !raw.includes('CODE-BBB') && !raw.includes('CODE-CCC'))
  }

  {
    // 抽选：只返回一个，且多码都有机会出现
    const seen = new Set()
    let shapeOk = true
    let tokenOk = true
    for (let i = 0; i < 30; i++) {
      const r = await api(`/api/token-deals/${dealId}/invite-code`)
      const d = r.json?.data
      if (!d || typeof d.code !== 'string' || !d.code) { shapeOk = false; break }
      if ('codes' in d) shapeOk = false
      if (typeof d.t !== 'string' || d.t.length !== 32) tokenOk = false
      seen.add(d.code)
    }
    check('邀请码接口始终只返回一个码（结构正确）', shapeOk)
    check('抽码同时下发 32 位凭证 t', tokenOk)
    check('30 次抽选命中多个不同码（非恒定）', seen.size >= 2, `命中 ${seen.size} 个：${[...seen].join(',')}`)
  }

  {
    // 展现比例：重权码应显著更常出现（换一条通告，避开上面已消耗的限频额度）
    await api(`/api/token-deals/${drawDeal}/invite-codes`, {
      method: 'PUT', cookie: admin,
      body: { codes: [
        { code: 'HEAVY', weight: 20, copyLimit: 0 },
        { code: 'LIGHT', weight: 1, copyLimit: 0 },
      ] },
    })
    let heavy = 0, light = 0
    for (let i = 0; i < 50; i++) {
      const r = await api(`/api/token-deals/${drawDeal}/invite-code`)
      const c = r.json?.data?.code
      if (c === 'HEAVY') heavy++
      else if (c === 'LIGHT') light++
    }
    // 期望 20:1；给足容差，只断言「重权明显更多」
    check('展现比例生效：权重 20 的码出现次数远多于权重 1', heavy > light * 3, `HEAVY=${heavy} LIGHT=${light}`)
  }

  {
    // 抽码限频：60 次/小时打满后必须 429，否则脚本可把整池码收割走
    await api(`/api/token-deals/${rateDeal}/invite-codes`, {
      method: 'PUT', cookie: admin,
      body: { codes: [{ code: 'RATE-LIMITED', weight: 1, copyLimit: 0 }] },
    })
    let blockedAt = 0
    for (let i = 1; i <= 61; i++) {
      const r = await api(`/api/token-deals/${rateDeal}/invite-code`)
      if (r.status === 429) { blockedAt = i; break }
      if (r.status !== 200) { blockedAt = -1; break }
    }
    check('抽码端点有限频（第 61 次被拒）', blockedAt === 61, `blockedAt=${blockedAt}`)
  }

  {
    // 复制阈值 + 凭证闸门
    await api(`/api/token-deals/${dealId}/invite-codes`, {
      method: 'PUT', cookie: admin,
      body: { codes: [{ code: 'LIMITED', weight: 1, copyLimit: 2 }] },
    })
    const first = await api(`/api/token-deals/${dealId}/invite-code`)
    const codeId = first.json?.data?.id
    const drawToken = first.json?.data?.t
    check('拿到待复制的码', !!codeId && first.json?.data?.code === 'LIMITED')

    const noToken = await api(`/api/token-deals/${dealId}/invite-code/${codeId}/copy`, {
      method: 'POST', body: {},
    })
    check('无凭证复制被拒 → 400（挡枚举 codeId 烧配额）', noToken.status === 400, `status=${noToken.status}`)
    const badToken = await api(`/api/token-deals/${dealId}/invite-code/${codeId}/copy`, {
      method: 'POST', body: { t: 'x'.repeat(32) },
    })
    check('伪造凭证复制被拒 → 400', badToken.status === 400, `status=${badToken.status}`)
    const wrongCode = await api(`/api/token-deals/${dealId}/invite-code/${codeId + 999}/copy`, {
      method: 'POST', body: { t: drawToken },
    })
    check('凭证与 codeId 不匹配 → 400', wrongCode.status === 400, `status=${wrongCode.status}`)
    // 回归：曾用 `t.length`（UTF-16 码元）判长、却用 timingSafeEqual 比字节，
    // 32 个汉字长度检查放行、字节数不等 → 抛 RangeError → 未认证即可打出 500。
    const multiByte = await api(`/api/token-deals/${dealId}/invite-code/${codeId}/copy`, {
      method: 'POST', body: { t: '汉'.repeat(32) },
    })
    check('多字节凭证 → 400 而非 500', multiByte.status === 400,
      `status=${multiByte.status} body=${multiByte.text.slice(0, 80)}`)
    const emojiToken = await api(`/api/token-deals/${dealId}/invite-code/${codeId}/copy`, {
      method: 'POST', body: { t: 'a'.repeat(30) + '😀' },
    })
    check('emoji 凭证（32 码元/36 字节）→ 400 而非 500', emojiToken.status === 400,
      `status=${emojiToken.status}`)

    const c1 = await api(`/api/token-deals/${dealId}/invite-code/${codeId}/copy`, {
      method: 'POST', body: { t: drawToken },
    })
    check('带凭证复制计数成功', c1.json?.data?.recorded === true, JSON.stringify(c1.json))

    // 第二次复制：阈值 2，重新抽一次拿新凭证
    const again = await api(`/api/token-deals/${dealId}/invite-code`)
    const c2 = await api(`/api/token-deals/${dealId}/invite-code/${again.json?.data?.id}/copy`, {
      method: 'POST', body: { t: again.json?.data?.t },
    })
    check('第 2 次复制计数成功', c2.json?.data?.recorded === true, JSON.stringify(c2.json))

    const after = await api(`/api/token-deals/${dealId}/invite-code`)
    check('用满后抽选返回空码', after.json?.data?.code === null, JSON.stringify(after.json))
    const d = await api(`/api/token-deals/${dealId}`)
    check('用满后详情 has_invite_code=false', d.json?.deal?.has_invite_code === false, JSON.stringify(d.json?.deal?.has_invite_code))
  }

  {
    // ═══ C1 回归：未过审通告的邀请码不得对匿名访客公开 ═══
    // 直接往临时库塞一条 pending 通告（HTTP 侧没有「造 pending 通告」的入口）
    const requireFromRoot = createRequire(join(ROOT, 'package.json'))
    const Database = requireFromRoot('better-sqlite3')
    const raw = new Database(dbPath)
    const now = Date.now()
    const pendingId = 'e2e_pending_probe'
    raw.prepare(`
      INSERT INTO token_deals (id, user_id, provider, title, url, models, region, quality,
        source_tag, category, status, note, created_at, updated_at)
      VALUES (?, 0, 'E2E', '未过审探针', 'https://example.com/p', '[]', 'cn', '中品',
        'official', 'token', 'pending', 'x', ?, ?)
    `).run(pendingId, now, now)
    raw.prepare(`
      INSERT INTO token_deal_invite_codes (deal_id, code, label, weight, copy_limit, copy_count, enabled, sort_order, created_at, updated_at)
      VALUES (?, 'SECRET-PENDING-CODE', '', 1, 0, 0, 1, 0, ?, ?)
    `).run(pendingId, now, now)
    const pendingCodeId = raw.prepare('SELECT id FROM token_deal_invite_codes WHERE deal_id = ?').get(pendingId).id
    raw.close()

    const detailR = await api(`/api/token-deals/${pendingId}`)
    check('C1：未过审通告详情对匿名 → 非 200', detailR.status !== 200, `status=${detailR.status}`)
    const drawR = await api(`/api/token-deals/${pendingId}/invite-code`)
    check('C1：未过审通告的邀请码对匿名 → 404', drawR.status === 404, `status=${drawR.status} body=${drawR.text.slice(0, 120)}`)
    check('C1：响应里没有任何码明文', !drawR.text.includes('SECRET-PENDING-CODE'))
    const copyR = await api(`/api/token-deals/${pendingId}/invite-code/${pendingCodeId}/copy`, {
      method: 'POST', body: {},
    })
    check('C1：未过审通告的复制计数对匿名 → 404', copyR.status === 404, `status=${copyR.status}`)
    const revR = await api(`/api/token-deals/${pendingId}/reviews`)
    check('C1 同根因：未过审通告的评测列表对匿名 → 404', revR.status === 404, `status=${revR.status}`)
  }

  {
    // ═══ M4 回归：游客指纹不得进入公开响应 ═══
    const requireFromRoot = createRequire(join(ROOT, 'package.json'))
    const Database = requireFromRoot('better-sqlite3')
    const raw = new Database(dbPath)
    const now = Date.now()
    const guestId = 'e2e_guest_probe'
    raw.prepare(`
      INSERT INTO token_deals (id, user_id, guest_name, guest_fingerprint, provider, title, url, models,
        region, quality, source_tag, category, status, state, note, created_at, updated_at)
      VALUES (?, 0, '游客甲', 'fp:deadbeefcafe1234', 'E2E', '游客探针', 'https://example.com/g', '[]',
        'cn', '中品', 'official', 'token', 'approved', 'published', 'x', ?, ?)
    `).run(guestId, now, now)
    raw.close()

    const detailR = await api(`/api/token-deals/${guestId}`)
    check('M4：公开详情不含 guest_fingerprint',
      !('guest_fingerprint' in (detailR.json?.deal || {})), JSON.stringify(Object.keys(detailR.json?.deal || {})))
    check('M4：公开详情原文搜不到指纹值', !detailR.text.includes('deadbeefcafe1234'))
    const listR = await api('/api/token-deals?limit=50')
    // 注意 every() 在空集上恒为真：先钉住「列表非空」，否则这条会在空集上假通过
    const m4Rows = listR.json?.deals || []
    check('M4：公开列表非空（后续断言的前提）', m4Rows.length > 0, `样本 ${m4Rows.length} 条`)
    check('M4：公开列表不含 guest_fingerprint',
      m4Rows.every(d => !('guest_fingerprint' in d)))
    check('M4：公开列表原文搜不到指纹值', !listR.text.includes('deadbeefcafe1234'))
    check('M4：游客自填展示名仍保留（非敏感）',
      (listR.json?.deals || []).some(d => d.id === guestId && d.guest_name === '游客甲'), 'guest_name 应保留')
  }

  {
    // ═══ MAJOR 回归：AI 通道同样不得下发游客指纹与内部字段 ═══
    // 根因是脱敏「按端点各写一遍」：AI 通道走 `SELECT td.*`，此前只有 web 端点清了
    // guest_fingerprint，于是 AI 通道一直在下发（实测确认过）。这条断言的价值在于
    // 「以后往 token_deals 加内部字段，AI 通道会被自动盯住」。
    const guestProbeId = 'e2e_guest_probe'
    const patR = await api('/api/user/api-tokens', {
      method: 'POST', cookie: alice, body: { name: 'e2e-ai-field-probe', scopes: 'read' },
    })
    const pat = patR.json?.token || patR.json?.plain || patR.json?.data?.token || ''
    check('AI 前置：创建只读 PAT', (patR.status === 200 || patR.status === 201) && !!pat,
      `status=${patR.status} body=${patR.text.slice(0, 120)}`)

    if (pat) {
      const auth = { Authorization: `Bearer ${pat}` }
      const aiR = await api('/api/ai/token-deals?limit=50', { headers: auth })
      check('AI 通道列表可访问', aiR.status === 200, `status=${aiR.status} body=${aiR.text.slice(0, 120)}`)
      const rows = aiR.json?.token_deals || aiR.json?.deals || []
      // 先证「列表非空且含探针」——否则下面几条「不含某键」会是在空集上假通过
      check('AI 通道确实返回了探针通告（后续断言的前提）',
        rows.some(d => d.id === guestProbeId),
        `样本 ${rows.length} 条，前几个 id: ${rows.slice(0, 5).map(d => d.id).join(',')}`)
      check('AI 通道列表不含 guest_fingerprint 键', rows.length > 0 && rows.every(d => !('guest_fingerprint' in d)), `样本 ${rows.length} 条`)
      check('AI 通道列表不含 deleted_by 键', rows.length > 0 && rows.every(d => !('deleted_by' in d)))
      check('AI 通道列表不含 verified_by 键', rows.length > 0 && rows.every(d => !('verified_by' in d)))
      check('AI 通道列表原文搜不到指纹值', !aiR.text.includes('deadbeefcafe1234'))
      check('AI 通道仍保留 models 等正常字段（非空集上检查）', rows.length > 0 && rows.every(d => 'models' in d), `样本 ${rows.length} 条`)
      void guestProbeId
    }
  }

  {
    // 权限：非作者非管理员不可读写码池
    const asAlice = await api(`/api/token-deals/${dealId}/invite-codes`, { cookie: alice })
    check('非作者读码池 → 403', asAlice.status === 403, `status=${asAlice.status}`)
    const aliceWrite = await api(`/api/token-deals/${dealId}/invite-codes`, {
      method: 'PUT', cookie: alice, body: { codes: [{ code: 'HACK', weight: 1, copyLimit: 0 }] },
    })
    check('非作者写码池 → 403', aliceWrite.status === 403, `status=${aliceWrite.status}`)
    const anonRead = await api(`/api/token-deals/${dealId}/invite-codes`)
    check('未登录读码池 → 401', anonRead.status === 401, `status=${anonRead.status}`)
    const dup = await api(`/api/token-deals/${dealId}/invite-codes`, {
      method: 'PUT', cookie: admin, body: { codes: [{ code: 'X' }, { code: 'X' }] },
    })
    check('重复邀请码被拒 → 400', dup.status === 400, `status=${dup.status}`)
    const missing = await api(`/api/token-deals/${dealId}/invite-codes`, { method: 'PUT', cookie: admin, body: {} })
    check('缺 codes 字段被拒 → 400（不静默清空）', missing.status === 400, `status=${missing.status}`)
  }

  {
    // 编辑保留 copy_count：改标题不应把已用满的码复活
    await api(`/api/token-deals/${dealId}/invite-codes`, {
      method: 'PUT', cookie: admin,
      body: { codes: [{ code: 'KEEP', weight: 1, copyLimit: 1 }] },
    })
    const got = await api(`/api/token-deals/${dealId}/invite-code`)
    await api(`/api/token-deals/${dealId}/invite-code/${got.json.data.id}/copy`, {
      method: 'POST', body: { t: got.json.data.t },
    })
    // 重新提交同一份码（模拟「编辑通告时随保存一起提交」）
    await api(`/api/token-deals/${dealId}/invite-codes`, {
      method: 'PUT', cookie: admin,
      body: { codes: [{ code: 'KEEP', weight: 1, copyLimit: 1 }] },
    })
    const pool = await api(`/api/token-deals/${dealId}/invite-codes`, { cookie: admin })
    const row = (pool.json?.data?.codes || [])[0]
    check('同码重提交保留 copy_count（不复活）', row?.copy_count === 1, JSON.stringify(row))
    check('该码仍标记已用满', row?.exhausted === true, JSON.stringify(row))
  }

  // ═══ ③ 备注：上限 + 富文本消毒 ═══
  console.log('\n▶ ③ 备注：2000 上限 + 富文本消毒')
  {
    // PUT /api/token-deals/:id 走的是**完整载荷**校验（与编辑器提交 {...cur} 一致），
    // 因此每次修改都必须带上全部必填字段，否则会先撞「服务商名称不能为空」
    const base = {
      provider: 'E2E', title: 'E2E 邀请码通告', url: 'https://example.com/join',
      call_url: 'https://example.com/v1', quota: '免费', models: ['e2e-model'],
      region: 'cn', quality: '中品', source_tag: 'official', category: 'token',
    }

    const r = await api(`/api/token-deals/${dealId}`, {
      method: 'PUT', cookie: admin, body: { ...base, note: 'a'.repeat(2000) },
    })
    check('备注 2000 字可保存 → 200', r.status === 200, `status=${r.status} ${r.text.slice(0, 160)}`)

    const tooLong = await api(`/api/token-deals/${dealId}`, {
      method: 'PUT', cookie: admin, body: { ...base, note: 'a'.repeat(2001) },
    })
    check('备注 2001 字被拒 → 400 且提示备注超长',
      tooLong.status === 400 && /备注/.test(tooLong.text), `status=${tooLong.status} ${tooLong.text.slice(0, 120)}`)

    const rich = await api(`/api/token-deals/${dealId}`, {
      method: 'PUT', cookie: admin,
      body: {
        ...base,
        note: '**加粗**\n\n<script>alert(1)</script>\n\n<img src="https://example.com/x.png" onerror="alert(2)">\n\n[链接](javascript:alert(3))\n\n| A | B |\n| - | - |\n| 1 | 2 |',
      },
    })
    check('富文本备注保存 → 200', rich.status === 200, `status=${rich.status} ${rich.text.slice(0, 160)}`)

    const d = await api(`/api/token-deals/${dealId}`)
    const html = String(d.json?.deal?.note_html || '')
    check('详情下发 note_html', html.length > 0)
    check('note_html 渲染了 Markdown 加粗', /<strong>/i.test(html), html.slice(0, 300))
    check('note_html 渲染了 Markdown 表格', /<table>/i.test(html), html.slice(0, 300))
    check('note_html 保留了正常图片', /<img[^>]+src="https:\/\/example\.com\/x\.png"/i.test(html), html.slice(0, 300))
    check('note_html 已剥掉 <script>', !/<script/i.test(html), html.slice(0, 300))
    check('note_html 已剥掉 onerror 事件属性', !/onerror/i.test(html), html.slice(0, 300))
    check('note_html 已剥掉 javascript: 协议', !/javascript:/i.test(html), html.slice(0, 300))
  }

  // ═══ ④ 前端脱敏 ═══
  console.log('\n▶ ④ 前端脱敏：公开详情/列表不得出现身份信息')
  {
    for (const [who, cookie] of [['匿名', undefined], ['普通用户', alice], ['管理员', admin]]) {
      const d = await api(`/api/token-deals/${dealId}`, { cookie })
      const deal = d.json?.deal || {}
      const verifs = d.json?.verifications || []
      check(`[${who}] 详情无 username 字段`, !('username' in deal))
      check(`[${who}] 详情 user_id 不下发`, deal.user_id === undefined, String(deal.user_id))
      check(`[${who}] 详情 deleted_by 不下发`, deal.deleted_by === undefined, String(deal.deleted_by))
      check(`[${who}] 详情 verified_by 为空串`, !deal.verified_by, JSON.stringify(deal.verified_by))
      // 生命周期原始列（2026-10-30 四轮补）：前端只需派生值 is_deleted / is_invalid /
      // invalid_reason_label，原始列是运营侧审计信息（谁删的、为什么判失效）。
      // 键应**不出现**（显式 undefined），不是「值为空」。
      check(`[${who}] 详情 deleted_at 不下发`, !('deleted_at' in deal), JSON.stringify(deal.deleted_at))
      check(`[${who}] 详情 invalid_reason 不下发`, !('invalid_reason' in deal), JSON.stringify(deal.invalid_reason))
      // 反向：派生字段与作者必需的 reject_reason 不能被脱敏做过界
      check(`[${who}] 详情 is_deleted 派生字段仍在`, 'is_deleted' in deal)
      check(`[${who}] 详情 invalid_reason_label 派生字段仍在`, 'invalid_reason_label' in deal)
      check(`[${who}] 详情 reject_reason 仍保留（作者改稿需要）`, 'reject_reason' in deal)
      check(`[${who}] 核验记录 actor 一律置空`, verifs.every(v => !v.actor), JSON.stringify(verifs.map(v => v.actor)))
    }
    for (const [who, cookie] of [['匿名', undefined], ['管理员', admin]]) {
      const l = await api('/api/token-deals', { cookie })
      const deals = l.json?.deals || []
      // 同上：every() 在空集上恒真，统一加非空前提
      check(`[${who}] 列表非空（后续断言的前提）`, deals.length > 0, `样本 ${deals.length} 条`)
      check(`[${who}] 列表无 username`, deals.every(d => !('username' in d)))
      check(`[${who}] 列表 user_id 不下发`, deals.every(d => d.user_id === undefined))
      check(`[${who}] 列表 deleted_by 不下发`, deals.every(d => d.deleted_by === undefined))
      check(`[${who}] 列表 verified_by 不下发`, deals.every(d => !d.verified_by))
      // 生命周期原始列同样不下发（与详情同口径）
      check(`[${who}] 列表 deleted_at 不下发`, deals.every(d => !('deleted_at' in d)))
      check(`[${who}] 列表 invalid_reason 不下发`, deals.every(d => !('invalid_reason' in d)))
      // 反向：列表的派生字段是 `is_hidden`（不是详情那套 is_deleted / is_invalid）
      check(`[${who}] 列表 is_hidden 派生字段仍在`, deals.every(d => 'is_hidden' in d))
    }
  }

  // ═══ ⑤ 模型拉取 SSRF 防护 ═══
  console.log('\n▶ ⑤ 模型拉取：SSRF 防护')
  {
    const cases = [
      ['环回 IP', 'http://127.0.0.1:1/v1'],
      ['localhost 主机名', 'http://localhost:3000/v1'],
      ['云元数据地址', 'http://169.254.169.254/latest/meta-data'],
      ['私网 10.x', 'http://10.0.0.1/v1'],
      ['私网 192.168.x', 'http://192.168.1.1/v1'],
      ['非 http 协议', 'file:///etc/passwd'],
      ['内嵌凭据', 'http://user:pass@example.com/v1'],
      ['.internal 域名', 'http://metadata.google.internal/v1'],
      // 2026-10-30 审查补的漏判网段（旧实现只做 startsWith 前缀匹配，这四段全放过）
      ['CGNAT 100.64/10', 'http://100.64.0.1:3999/v1'],
      ['基准保留段 198.18/15', 'http://198.18.0.1:3999/v1'],
      ['协议专用 192.0.0/24', 'http://192.0.0.1:3999/v1'],
      ['组播 224/4', 'http://224.0.0.1:3999/v1'],
      ['保留 240/4', 'http://240.0.0.1:3999/v1'],
    ]
    for (const [label, url] of cases) {
      const r = await api('/api/token-deals/fetch-models', { method: 'POST', cookie: admin, body: { call_url: url } })
      check(`拒绝 ${label} → 400`, r.status === 400, `status=${r.status} body=${r.text.slice(0, 120)}`)
    }
    const empty = await api('/api/token-deals/fetch-models', { method: 'POST', cookie: admin, body: {} })
    check('缺 API 地址 → 400', empty.status === 400, `status=${empty.status}`)

    // 关于「成功出站」：本机 DNS 是 fake-ip（所有主机名都解析到 198.18/15），
    // 而 1.x.x.x 这类公网 IP 字面量会被 Cloudflare 301/302 到 one.one.one.one（主机名），
    // 第二次校验就又落到 fake-ip 上 —— 所以本机**构造不出**一次成功的出站请求。
    // 因此成功路径放到生产环境验收（正文里那条 1.0.0.1 探针已确认机器本身有公网直连）。
    // 「校验过的地址是否真的被钉到连接上」由 scripts/ssrf-pin-check.mjs 单独验证。
    const pub = await api('/api/token-deals/fetch-models', {
      method: 'POST', cookie: admin, body: { call_url: 'https://1.0.0.1/v1/models' },
    })
    // ⚠️ 这条断言的**名与实**要分清（2026-11-09 修过一次，记下来免得再写歪）。
    //
    // 原判据是 `/内网|不是 JSON|模型清单接口|无法连接|响应超时/`，而护栏拒绝时的文案正是
    // 「不允许访问内网地址」—— 含「内网」。也就是说护栏**误拦公网地址**时它照样通过：
    // 名字写着「报错不是地址类护栏拦截」，判据却把护栏文案当成通过条件，**自相矛盾**。
    //
    // 但我把它收紧成「不许出现护栏文案」后又当场报红，实测到的正是
    // `{"error":"不允许访问内网地址"}` —— 因为本机 fake-ip 下 1.0.0.1 会被重定向到
    // one.one.one.one，该主机名解析进 198.18/15（基准保留段）而被**正确地**拦下。
    // 同一台机器上另一时刻实测到的是「响应超时」。也就是说
    // **本机根本无法稳定制造「公网字面量走到连接阶段」这个状态**，这条断言证明不了那件事。
    //
    // 所以这条只断言「进程没崩、给出了 400 且是中文出站错误」，不再声称触及连接阶段；
    // 「公网地址不得被误判为内网」这条不变式由**确定性**的
    // `scripts/private-ip-check.mjs`（`1.1.1.1` / `8.8.8.8` 等公网清单 + 边界段）守着，
    // 那条不依赖网络、不会因 fake-ip 而摇摆。
    check('公网字面量未触发 5xx（护栏与出站环节给出可读的 400）',
      pub.status === 400 && /内网|不是 JSON|模型清单接口|无法连接|响应超时|重定向次数超限/.test(String(pub.json?.error || '')),
      `status=${pub.status} body=${pub.text.slice(0, 160)}`)
    console.log(`  ⚠ 成功出站路径本机无法验证（fake-ip DNS），留待生产验收`)
    if (/不允许访问内网地址/.test(String(pub.json?.error || ''))) {
      console.log('  ℹ 本次是经重定向落到 fake-ip 保留段而被拦（属预期行为，非缺陷）')
    }
  }

  // ═══ ⑤b 书签 URL 协议白名单（存储型 XSS 回归，2026-11-05）═══
  //
  // 背景：原实现是**黑名单**（javascript:/data:/vbscript:/file:）+ `startsWith` 逐条比对。
  // 但按 WHATWG 规范，浏览器在解析 URL 协议前会剥离所有 ASCII tab / 换行 / 回车，
  // 于是 `java\tscript:alert(1)` 匹配不上黑名单而放行，浏览器却解析成 `javascript:` —
  // 而 `BookmarkCard.vue` 是 `:href="bookmark.url"` 直接渲染，构成**存储型 XSS**。
  //
  // 这里断言两件事：注入变体**必须被拒**，合法 URL **必须仍可写入**（防过度收紧）。
  console.log('\n▶ ⑤b 书签 URL 协议白名单（注入变体 + 合法放行）')
  {
    const bad = [
      ['经典 javascript:', 'javascript:alert(1)'],
      ['大小写变形', 'JavaScript:alert(1)'],
      ['首尾空白包裹', '   javascript:alert(1)   '],
      ['TAB 注入（旧实现放行）', 'java\tscript:alert(1)'],
      ['LF 注入（旧实现放行）', 'java\nscript:alert(1)'],
      ['CR 注入（旧实现放行）', 'java\rscript:alert(1)'],
      ['data: 伪协议', 'data:text/html,<script>alert(1)</script>'],
      ['vbscript:', 'vbscript:msgbox(1)'],
      ['file:', 'file:///etc/passwd'],
      ['blob:', 'blob:https://example.com/uuid'],
      ['无协议', 'example.com/no-scheme'],
    ]
    for (const [label, u] of bad) {
      const r = await api('/api/bookmarks', { method: 'POST', cookie: alice, body: { title: `xss-${label}`, url: u } })
      check(`拒绝 ${label}`, r.status === 400, `status=${r.status} body=${r.text.slice(0, 120)}`)
    }
    const good = [
      ['https', 'https://example.com/xss-ok-1'],
      ['http', 'http://example.com/xss-ok-2'],
      ['大写协议', 'HTTPS://Example.com/xss-ok-3'],
      ['带路径与查询', 'https://example.com/a/b?c=d&e=f'],
    ]
    for (const [label, u] of good) {
      const r = await api('/api/bookmarks', { method: 'POST', cookie: alice, body: { title: `ok-${label}`, url: u } })
      check(`放行合法 ${label}`, r.status === 200, `status=${r.status} body=${r.text.slice(0, 120)}`)
    }
  }

  // ── 错误出口契约（error-handler 的对外承诺）────────────────────
  //
  // 这个出口是**所有 API 错误响应的唯一格式化点**（server/plugins/error-handler.ts），
  // 它同时承担两条承诺：
  //   1. 4xx 保留业务语义（前端要拿它提示用户），但抹掉文件系统绝对路径；
  //   2. 5xx 一律替换成通用文案，细节只进服务端日志 —— 否则
  //      better-sqlite3 的 `ENOENT ... open '/www/.../favshub.db'` 会把部署根路径泄出去。
  //
  // 此前**没有任何套件断言这两条**。2026-10-31 改动该插件（补页面 SSR 日志）后
  // 才意识到：这么核心的安全边界，只有人肉 curl 看过。
  {
    // 1) 4xx：错误消息是中文业务文案，且不含绝对路径
    const notFound = await api('/api/token-deals/deal_definitely_not_exist_xyz')
    check('错误出口：4xx 保留业务语义', notFound.status === 404 && /不存在/.test(String(notFound.json?.error || '')),
      `status=${notFound.status} body=${notFound.text.slice(0, 80)}`)
    check('错误出口：4xx 不泄露绝对路径', !/\/(www|root|home|opt|Users)\//.test(String(notFound.json?.error || '')),
      `body=${notFound.text.slice(0, 120)}`)

    // 2) 响应必须是 JSON 且只有一个 error 字段（旧 Express 契约，前端依赖它）
    check('错误出口：4xx 响应是 { error } 形状',
      !!notFound.json && typeof notFound.json?.error === 'string',
      `body=${notFound.text.slice(0, 80)}`)

    // 3) 未认证 → 401，同样走这个出口（而不是裸 401 空体）
    const noAuth = await api('/api/ai/describe')
    check('错误出口：401 也带可读的 error 文案',
      noAuth.status === 401 && /令牌/.test(String(noAuth.json?.error || '')),
      `status=${noAuth.status} body=${noAuth.text.slice(0, 80)}`)

    // 4) 页面路径的错误**不能**被这个插件接管（它只对 `/api/` 生效），
    //    页面错误要继续交给 Nitro 渲染 `error.vue`。
    //
    // ⚠️ 这里必须显式带 `Accept: text/html`。Nitro 会按 Accept **做内容协商**：
    //      · `Accept: text/html`        → 渲染 error.vue（HTML）
    //      · `Accept: application/json` → 返回 { error, url, statusCode } JSON
    //      · Node fetch 默认 `*/*`      → 走 JSON 分支
    //    2026-10-31 实测：不带这个头会拿到 JSON，从而误判「插件接管了页面」。
    //    真正要验的是「浏览器来访时仍是 HTML」，所以按浏览器的 Accept 发。
    const pageR = await fetch(BASE + '/collections/definitely_not_exist_xyz', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    const pageBody = await pageR.text()
    check('页面错误仍是 HTML（不被 API 出口接管）',
      pageR.status === 404 && /^\s*<!DOCTYPE html/i.test(pageBody),
      `status=${pageR.status} head=${pageBody.slice(0, 40).replace(/\s+/g, ' ')}`)
  }

  await stopApp()
    // 清理临时库：**必须连 WAL/SHM 边车一起删** —— 只删 .db 会留下 -wal/-shm，
    // 在 data/ 里越攒越多（本仓 WAL 模式下每次运行都会生成这两个文件）。
    await cleanupDb()
}

let exitCode = 0
try {
  await main()
} catch (err) {
  failCount++
  failures.push(`脚本异常：${err?.message || err}`)
  console.error('\n✗ 脚本异常：', err?.stack || err)
  await stopApp()
  await cleanupDb()   // 失败时更要清：这条路径此前漏了，残留的全是失败那几次跑出来的
  exitCode = 1
}

console.log(`\n═══ 结果：${passCount} 通过 / ${failCount} 失败 ═══`)
if (failures.length) {
  console.log('失败项：')
  failures.forEach(f => console.log('  -', f))
  exitCode = 1
}
process.exit(exitCode)
