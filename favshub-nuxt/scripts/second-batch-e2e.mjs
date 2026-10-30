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
async function api(path, { method = 'GET', cookie, body } = {}) {
  const headers = {}
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
        region, quality, source_tag, category, status, note, created_at, updated_at)
      VALUES (?, 0, '游客甲', 'fp:deadbeefcafe1234', 'E2E', '游客探针', 'https://example.com/g', '[]',
        'cn', '中品', 'official', 'token', 'approved', 'x', ?, ?)
    `).run(guestId, now, now)
    raw.close()

    const detailR = await api(`/api/token-deals/${guestId}`)
    check('M4：公开详情不含 guest_fingerprint',
      !('guest_fingerprint' in (detailR.json?.deal || {})), JSON.stringify(Object.keys(detailR.json?.deal || {})))
    check('M4：公开详情原文搜不到指纹值', !detailR.text.includes('deadbeefcafe1234'))
    const listR = await api('/api/token-deals?limit=50')
    check('M4：公开列表不含 guest_fingerprint',
      (listR.json?.deals || []).every(d => !('guest_fingerprint' in d)))
    check('M4：公开列表原文搜不到指纹值', !listR.text.includes('deadbeefcafe1234'))
    check('M4：游客自填展示名仍保留（非敏感）',
      (listR.json?.deals || []).some(d => d.id === guestId && d.guest_name === '游客甲'), 'guest_name 应保留')
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
      check(`[${who}] 核验记录 actor 一律置空`, verifs.every(v => !v.actor), JSON.stringify(verifs.map(v => v.actor)))
    }
    for (const [who, cookie] of [['匿名', undefined], ['管理员', admin]]) {
      const l = await api('/api/token-deals', { cookie })
      const deals = l.json?.deals || []
      check(`[${who}] 列表无 username`, deals.every(d => !('username' in d)))
      check(`[${who}] 列表 user_id 不下发`, deals.every(d => d.user_id === undefined))
      check(`[${who}] 列表 deleted_by 不下发`, deals.every(d => d.deleted_by === undefined))
      check(`[${who}] 列表 verified_by 不下发`, deals.every(d => !d.verified_by))
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
    check('公网字面量走到了连接阶段（报错不是「地址格式」类护栏拦截）',
      pub.status === 400 && /内网|不是 JSON|模型清单接口|无法连接|响应超时/.test(String(pub.json?.error || '')),
      `status=${pub.status} body=${pub.text.slice(0, 160)}`)
    console.log(`  ⚠ 成功出站路径本机无法验证（fake-ip DNS），留待生产验收`)
  }

  await stopApp()
  try { const { rmSync } = await import('node:fs'); rmSync(dbPath, { force: true }) } catch {}
}

let exitCode = 0
try {
  await main()
} catch (err) {
  failCount++
  failures.push(`脚本异常：${err?.message || err}`)
  console.error('\n✗ 脚本异常：', err?.stack || err)
  await stopApp()
  exitCode = 1
}

console.log(`\n═══ 结果：${passCount} 通过 / ${failCount} 失败 ═══`)
if (failures.length) {
  console.log('失败项：')
  failures.forEach(f => console.log('  -', f))
  exitCode = 1
}
process.exit(exitCode)
