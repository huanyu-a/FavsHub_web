#!/usr/bin/env node
/**
 * state-machine.mjs — 通告统一状态机（`token_deals.state` 列）端到端自测
 *
 * 先决条件：`pnpm build` 已产出 `.output/`。
 *
 * ## 为什么要单独一个套件
 *
 * 2026-11-04 把状态从四个字段（status + deleted_at + invalid_at + expires_at）
 * 收敛成单列 `state`，并新增 `verified`（已审核）这一档。这次改动动了
 * **所有可见性判定**，而可见性判错的两个方向都是事故：
 *   - 判松了 → 未发布的条目（链接还指向他站的导入渠道）直接对外，就是之前
 *     「10 条域名被误发布」那类问题；
 *   - 判紧了 → 线上条目全部消失（迁移回填卡在默认值 'pending' 时正是如此）。
 *
 * 所以本套件的重点是**边界两侧都钉住**：
 *   1. 只有 published 对公众可见，其余六档一律 404 —— 且 404 文案一致，
 *      不泄露「这个 id 存在但没批」；
 *   2. 审核通过(verified) ≠ 自动上线(published)，这是本次最核心的语义分界；
 *   3. 旧四列继续双写，回滚到旧镜像后数据仍自洽；
 *   4. 作者不能自发布 / 自审核。
 *
 * 用法：node scripts/state-machine.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { startWithFreePort } from './lib/free-port.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * 端口改为**运行时选空闲端口 + 端口冲突换端口重试**（2026-11-09；逻辑收敛到
 * `scripts/lib/free-port.mjs`，本文件不再自带 pickFreePort）。
 *
 * 原先是硬编码 `3266`，注释里叫「独占端口」—— 当时假设「没有别的东西会用这个端口」。
 * 这个假设在本仓库里不成立：本机任何残留进程、另一个套件的手工调试实例，都能占住它。
 * 一旦被占，症状是 `startApp` 抛「端口 3266 仍被占用」，而**断言数随之中断解析**，
 * 于是 `assertion-count --check` 会把「某个套件起不来」报成「文档数字不符，请更新文档」——
 * 照着那个提示去改文档，恰好会把真实覆盖丢掉（这个坑我踩过一次，见 assertion-count.mjs 里同日的注释）。
 *
 * 现在先绑 `:0` 拿一个内核分配的空闲端口再释放，立刻用它起应用；**若起不来且证据是
 * 「端口被占」，就换一个端口重试**（释放到真正 listen 之间仍有竞争窗口，光靠挑端口不够）。
 * `waitPortFree` 保留：它给出更清楚的病因，而且它抛出的「端口 N 仍被占用」正好是重试的判据之一。
 */
let APP_PORT = 0
/** 由每次尝试开始时按**当次**端口重算 —— 重试会换端口，所以不能是常量 */
let BASE = ''
const WORK = mkdtempSync(join(tmpdir(), 'favshub-state-'))
const DB_PATH = join(WORK, 'state.db')
/** 临时库的一次性口令，非机密（库随进程结束即删） */
const PASSWORD = 'StateTest2026!'

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

// ── 数据库直读（断言「真的落库」，不信接口自述）─────────────
function requireFromRoot(mod) {
  return createRequire(join(ROOT, 'package.json'))(mod)
}
function withDb(fn) {
  const Database = requireFromRoot('better-sqlite3')
  const db = new Database(DB_PATH)
  try { return fn(db) } finally { db.close() }
}
/**
 * 关掉「注册人机校验」。
 *
 * 注册通道的 Turnstile 默认开启（fail-closed），测试环境拿不到真 token，
 * 故把 `register_turnstile_enabled` 置 false —— 与 scripts/third-batch-server.mjs、
 * scripts/second-batch-e2e.mjs 同一手法。必须在应用启动后调用：`system_config`
 * 表由应用建库时创建。`getConfig()` 每次读库、不缓存，所以运行中改即时生效。
 */
function disableRegisterChallenge() {
  withDb(db => db.prepare(
    "INSERT INTO system_config(key,value) VALUES('register_turnstile_enabled','false') "
    + 'ON CONFLICT(key) DO UPDATE SET value=\'false\'',
  ).run())
}
/** 取一条通告的完整状态行（新列 + 旧列，用于双写校验） */
function rowOf(id) {
  return withDb(db => db.prepare(
    'SELECT id, state, status, deleted_at, deleted_by, invalid_at, invalid_reason, expires_at'
    + ' FROM token_deals WHERE id = ?'
  ).get(id))
}
function stateOf(id) { return rowOf(id)?.state }
/** 公开列表里是否出现该 id */
async function inPublicList(id) {
  const r = await api('/api/token-deals?limit=100')
  return (r.json?.deals || []).some(d => d.id === id)
}
/** 公开详情 HTTP 状态（API 与 .html 页面各一条路径都要挡） */
async function publicDetailStatus(id) {
  const r = await api(`/api/token-deals/${id}`)
  return r.status
}

// ── 应用进程 ────────────────────────────────────────────────
let appProcess = null
function ensureNativeModule() {
  const load = () => { try { requireFromRoot('better-sqlite3'); return true } catch { return false } }
  if (!load()) throw new Error('better-sqlite3 无法在当前 node ' + process.version + ' 下加载')
}
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
/**
 * 起一次应用：端口由 `startWithFreePort` 传入，并写进模块级 `APP_PORT` / `BASE`。
 * 就绪探测 / 40s 超时 / 日志捕获 / early-exit 逻辑与原实现逐字一致。
 */
async function startOnce(port) {
  APP_PORT = port
  BASE = `http://127.0.0.1:${port}`
  console.log(`  · 试用端口 ${port}`)
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 `pnpm build`'); process.exit(1) }
  ensureNativeModule()
  await waitPortFree()
  const logs = []
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(APP_PORT),
      NUXT_DB_PATH: DB_PATH,
      NUXT_ADMIN_USERS: 'smadmin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', d => logs.push(String(d)))
  appProcess.stderr.on('data', d => logs.push(String(d)))
  let earlyExit = null
  appProcess.on('exit', (code, signal) => { earlyExit = { code, signal }; appProcess = null })
  const start = Date.now()
  while (Date.now() < start + 40_000) {
    if (earlyExit) throw new Error(`应用启动即退出（code=${earlyExit.code}）：\n${logs.join('').slice(-800)}`)
    try { const r = await fetch(`${BASE}/api/announcements`, { signal: AbortSignal.timeout(3000) }); if (r.ok) return logs } catch { /* 还没起来（含探测超时：对端接而不答） */ }
    await sleep(400)
  }
  throw new Error('应用 40s 内未就绪')
}
/**
 * 对外入口：挑空闲端口 → 起应用；**只有证据是「端口被占」时才换端口重试**。
 * 其它错误（ABI 不匹配、迁移失败…）由 startWithFreePort 立刻抛出，不空转 5 次。
 */
async function startApp() {
  return startWithFreePort(async (port) => {
    try {
      return await startOnce(port)
    } catch (e) {
      // 失败的那次子进程若还活着（只有「就绪超时」这条路径会这样），先收掉再换端口，
      // 否则重试会留下一个占着旧端口的孤儿进程。
      await stopApp()
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
  const exited = new Promise(resolve => proc.on('exit', resolve))
  proc.kill('SIGTERM')
  const done = await Promise.race([exited, sleep(8000).then(() => 'timeout')])
  if (done === 'timeout') {
    proc.kill('SIGKILL')
    await Promise.race([exited, sleep(3000)])
  }
}

/** 合法的创建载荷（服务端要求 provider / title / url） */
function dealBody(n, extra = {}) {
  return {
    provider: `状态机服务商${n}`,
    title: `状态机通告 ${n}`,
    url: `https://example.com/sm/${n}`,
    call_url: `https://example.com/sm/${n}/redeem`,
    quota: '10 美元/月',
    models: ['GLM-5'],
    region: 'cn',
    quality: '中品',
    category: 'token',
    note: `备注 ${n}`,
    ...extra,
  }
}

// ════════════════════════════════════════════════════════════
async function main() {
  console.log(`▶ 起应用（运行时选空闲端口），临时库 ${DB_PATH}`)
  await startApp()
  disableRegisterChallenge()

  const reg1 = await api('/api/auth/register', { method: 'POST', body: { username: 'smadmin', password: PASSWORD } })
  const reg2 = await api('/api/auth/register', { method: 'POST', body: { username: 'smuser', password: PASSWORD } })
  check('管理员账号注册成功', reg1.status === 200, `status=${reg1.status} ${reg1.text.slice(0, 160)}`)
  check('普通用户账号注册成功', reg2.status === 200, `status=${reg2.status} ${reg2.text.slice(0, 160)}`)
  const admin = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'smadmin', password: PASSWORD } })).res)
  const user = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'smuser', password: PASSWORD } })).res)
  check('两边都拿到 Cookie', !!admin && !!user)

  // ═══ ① 管理员创建 = 直接发布 ═══
  console.log('\n▶ ① 管理员创建 → 已发布')
  let idAdmin = ''
  {
    const r = await api('/api/token-deals', { method: 'POST', cookie: admin, body: dealBody(1) })
    check('管理员创建通告 200', r.status === 200, `status=${r.status} ${r.text.slice(0, 160)}`)
    checkEq('创建返回 state = published', r.json?.state, 'published')
    const created = r.json?.deal_id || ''
    idAdmin = created
    check('拿到新通告 id', !!created, JSON.stringify(r.json).slice(0, 200))
    const row = rowOf(created)
    check('库中 state = published', row?.state === 'published', `实际 ${row?.state}`)
    checkEq('旧列 status 双写为 approved', row?.status, 'approved')
    check('公开列表可见', await inPublicList(created))
    checkEq('公开详情 200', await publicDetailStatus(created), 200)
    checkEq('.html 详情页 200', (await api(`/tokens/${created}.html`)).status, 200)
  }

  // ═══ ② 普通用户创建 = 待审核，对外 404 ═══
  console.log('\n▶ ② 普通用户创建 → 待审核（对外不可见）')
  let idUser = ''
  {
    const r = await api('/api/token-deals', { method: 'POST', cookie: user, body: dealBody(2) })
    check('普通用户创建 200', r.status === 200, `status=${r.status} ${r.text.slice(0, 160)}`)
    idUser = r.json?.deal_id || ''
    check('拿到新通告 id', !!idUser, JSON.stringify(r.json).slice(0, 200))
    checkEq('库中 state = pending', stateOf(idUser), 'pending')
    checkEq('旧列 status 双写为 pending', rowOf(idUser)?.status, 'pending')
    check('公开列表不含它', !(await inPublicList(idUser)))
    checkEq('匿名公开详情 404', await publicDetailStatus(idUser), 404)
    checkEq('匿名 .html 页 404', (await api(`/tokens/${idUser}.html`)).status, 404)
    checkEq('作者本人可读 200', (await api(`/api/token-deals/${idUser}`, { cookie: user })).status, 200)
    checkEq('管理员可读 200', (await api(`/api/token-deals/${idUser}`, { cookie: admin })).status, 200)
  }

  // ═══ ③ 核心：审核通过 ≠ 发布 ═══
  console.log('\n▶ ③ 审核通过 → verified（仍不对外，这是本次核心语义）')
  {
    const r = await api(`/api/admin/token-deals/${idUser}/review`, {
      method: 'POST', cookie: admin, body: { action: 'approve' },
    })
    check('审核通过 200', r.status === 200, `status=${r.status} ${r.text.slice(0, 160)}`)
    checkEq('库中 state = verified（不是 published）', stateOf(idUser), 'verified')
    checkEq('旧列 status 双写为 approved', rowOf(idUser)?.status, 'approved')
    // ↓ 这三条是本次改动的核心断言：审过了但没发布，对外依然不存在
    check('★ 已审核但未发布：公开列表仍不含它', !(await inPublicList(idUser)))
    checkEq('★ 已审核但未发布：匿名详情仍 404', await publicDetailStatus(idUser), 404)
    checkEq('★ 已审核但未发布：.html 页仍 404', (await api(`/tokens/${idUser}.html`)).status, 404)
    check('sitemap 不含未发布条目', !(await api('/sitemap.xml')).text.includes(idUser))
    // 但它确实进了「已审核」队列，管理员能看见并操作
    const q = await api('/api/admin/token-deals?status=verified&limit=100', { cookie: admin })
    check('后台「已审核」队列含它', (q.json?.deals || []).some(d => d.id === idUser),
      JSON.stringify(q.json?.counts || {}))
  }

  // ═══ ④ 发布 ═══
  console.log('\n▶ ④ 发布 → 对外可见')
  {
    const r = await api(`/api/admin/token-deals/${idUser}/state`, {
      method: 'PUT', cookie: admin, body: { state: 'published' },
    })
    check('设为 published 200', r.status === 200, `status=${r.status} ${r.text.slice(0, 160)}`)
    checkEq('响应回显 from/to', [r.json?.from, r.json?.to], ['verified', 'published'])
    checkEq('库中 state = published', stateOf(idUser), 'published')
    check('公开列表可见', await inPublicList(idUser))
    checkEq('匿名详情 200', await publicDetailStatus(idUser), 200)
    check('sitemap 含已发布条目', (await api('/sitemap.xml')).text.includes(idUser))
  }

  // ═══ ⑤ 下架 / 失效 / 驳回都不对外 ═══
  console.log('\n▶ ⑤ 下架 / 失效 / 驳回 → 一律不对外')
  {
    await api(`/api/admin/token-deals/${idUser}/state`, { method: 'PUT', cookie: admin, body: { state: 'offline' } })
    checkEq('下架后 state = offline', stateOf(idUser), 'offline')
    checkEq('下架后匿名详情 404', await publicDetailStatus(idUser), 404)
    check('下架后公开列表不含', !(await inPublicList(idUser)))
    checkEq('作者仍能读自己的（200）', (await api(`/api/token-deals/${idUser}`, { cookie: user })).status, 200)

    // 回到发布，再测失效
    await api(`/api/admin/token-deals/${idUser}/state`, { method: 'PUT', cookie: admin, body: { state: 'published' } })
    await api(`/api/admin/token-deals/${idUser}/state`, { method: 'PUT', cookie: admin, body: { state: 'invalid' } })
    const inv = rowOf(idUser)
    checkEq('失效后 state = invalid', inv?.state, 'invalid')
    check('失效后写入了 invalid_at（双写）', !!inv?.invalid_at, `invalid_at=${inv?.invalid_at}`)
    checkEq('失效原因默认 manual', inv?.invalid_reason, 'manual')
    checkEq('失效后匿名详情 404', await publicDetailStatus(idUser), 404)
    check('失效后公开列表不含', !(await inPublicList(idUser)))

    // 驳回
    await api(`/api/admin/token-deals/${idUser}/state`, { method: 'PUT', cookie: admin, body: { state: 'rejected', reason: '测试驳回' } })
    checkEq('驳回后 state = rejected', stateOf(idUser), 'rejected')
    checkEq('驳回后旧列 status = rejected', rowOf(idUser)?.status, 'rejected')
    checkEq('驳回原因落库', withDb(db => db.prepare('SELECT reject_reason FROM token_deals WHERE id = ?').get(idUser))?.reject_reason, '测试驳回')
  }

  // ═══ ⑥ 作者编辑被驳回的条目 → 回到待审 ═══
  console.log('\n▶ ⑥ 作者编辑被驳回条目 → 回到待审核')
  {
    const r = await api(`/api/token-deals/${idUser}`, {
      method: 'PUT', cookie: user, body: { ...dealBody(2, { title: '状态机通告 2（已修改）' }) },
    })
    check('作者编辑自己的被驳回条目 200', r.status === 200, `status=${r.status} ${r.text.slice(0, 200)}`)
    checkEq('state 回到 pending（否则作者改完永远不进审核队列）', stateOf(idUser), 'pending')
    checkEq('旧列 status 同步回 pending', rowOf(idUser)?.status, 'pending')
  }

  // ═══ ⑦ 权限：作者不能自发布 / 自审核 ═══
  console.log('\n▶ ⑦ 权限：作者不能自发布、自审核')
  {
    for (const st of ['published', 'verified']) {
      const r = await api(`/api/admin/token-deals/${idUser}/state`, {
        method: 'PUT', cookie: user, body: { state: st },
      })
      checkEq(`作者设 ${st} 被拒 403`, r.status, 403)
      check(`拒绝后 state 未被改动（仍 pending）`, stateOf(idUser) === 'pending', `实际 ${stateOf(idUser)}`)
    }
    const own = await api(`/api/admin/token-deals/${idUser}/state`, {
      method: 'PUT', cookie: user, body: { state: 'offline' },
    })
    check('作者可以下架自己的条目', own.status === 200, `status=${own.status} ${own.text.slice(0, 120)}`)
    checkEq('下架生效', stateOf(idUser), 'offline')

    // 别人的条目：连存在性都不该暴露
    const other = await api(`/api/admin/token-deals/${idAdmin}/state`, {
      method: 'PUT', cookie: user, body: { state: 'offline' },
    })
    checkEq('作者动别人的条目 → 404（不是 403，不泄露存在性）', other.status, 404)
    checkEq('别人条目未被改动', stateOf(idAdmin), 'published')

    const anon = await api(`/api/admin/token-deals/${idUser}/state`, {
      method: 'PUT', body: { state: 'published' },
    })
    check('未登录 → 401/403', [401, 403].includes(anon.status), `status=${anon.status}`)
  }

  // ═══ ⑧ 参数校验 ═══
  console.log('\n▶ ⑧ 参数校验')
  {
    const bad1 = await api(`/api/admin/token-deals/${idAdmin}/state`, {
      method: 'PUT', cookie: admin, body: { state: 'garbage' },
    })
    checkEq('非法状态值 → 400', bad1.status, 400)
    const bad2 = await api(`/api/admin/token-deals/${idAdmin}/state`, {
      method: 'PUT', cookie: admin, body: {},
    })
    checkEq('缺 state → 400', bad2.status, 400)
    const bad3 = await api('/api/admin/token-deals/no_such_deal_xyz/state', {
      method: 'PUT', cookie: admin, body: { state: 'published' },
    })
    checkEq('不存在的 id → 404', bad3.status, 404)
    // deleted 不在可设置集合里：删除必须走软删除端点，保证「可恢复」语义不被绕过
    const bad4 = await api(`/api/admin/token-deals/${idAdmin}/state`, {
      method: 'PUT', cookie: admin, body: { state: 'deleted' },
    })
    checkEq('state=deleted 被拒（删除只走软删除端点）', bad4.status, 400)
    checkEq('且未被误删', stateOf(idAdmin), 'published')
  }

  // ═══ ⑨ 404 文案一致，不泄露存在性 ═══
  console.log('\n▶ ⑨ 未发布条目与不存在的条目，响应不可区分')
  {
    const hidden = await api(`/api/token-deals/${idUser}`)           // offline
    const missing = await api('/api/token-deals/sm_nope_missing')
    checkEq('两者 HTTP 状态一致', hidden.status, missing.status)
    checkEq('两者错误文案一致', hidden.json?.data?.error || hidden.json?.error,
      missing.json?.data?.error || missing.json?.error)
    check('文案里不含「审核」「驳回」「失效」等内部状态词',
      !/审核|驳回|失效|下架|状态/.test(hidden.text), hidden.text.slice(0, 120))
  }

  // ═══ ⑩ 软删除与恢复 ═══
  console.log('\n▶ ⑩ 软删除 / 恢复')
  {
    const del = await api(`/api/token-deals/${idAdmin}`, { method: 'DELETE', cookie: admin })
    check('删除 200', del.status === 200, `status=${del.status} ${del.text.slice(0, 160)}`)
    const row = rowOf(idAdmin)
    checkEq('state = deleted', row?.state, 'deleted')
    check('旧的 deleted_at 也被写入（双写，回滚后仍可追溯）', !!row?.deleted_at)
    checkEq('匿名详情 404', await publicDetailStatus(idAdmin), 404)
    checkEq('管理员详情仍可读 200', (await api(`/api/token-deals/${idAdmin}`, { cookie: admin })).status, 200)

    const res = await api(`/api/admin/token-deals/${idAdmin}/restore`, {
      method: 'POST', cookie: admin, body: { action: 'restore_delete' },
    })
    check('恢复 200', res.status === 200, `status=${res.status} ${res.text.slice(0, 160)}`)
    checkEq('恢复后回到 published（删除前就是 published）', stateOf(idAdmin), 'published')
    checkEq('deleted_at 已清空', rowOf(idAdmin)?.deleted_at, null)
    checkEq('恢复后匿名详情 200', await publicDetailStatus(idAdmin), 200)
  }

  // ═══ ⑪ 到期自动失效 ═══
  console.log('\n▶ ⑪ 到期 → 自动失效')
  {
    const past = Date.now() - 60_000
    withDb(db => db.prepare(`
      INSERT INTO token_deals (id, user_id, provider, title, url, models, region, quality,
        source_tag, category, status, state, expires_at, note, pinned, created_at, updated_at)
      VALUES ('sm_expired', 0, '过期服务商', '过期通告', 'https://example.com/exp', '[]',
        'cn', '中品', 'official', 'token', 'approved', 'published', ?, 'x', 0, ?, ?)
    `).run(past, past, past))
    checkEq('造出的过期条目 state = published', stateOf('sm_expired'), 'published')
    // 无需等归档：公开列表按时间判过期，运行时就不该出现
    check('已过期的 published 不进公开列表（运行时按时间判）', !(await inPublicList('sm_expired')))
    checkEq('已过期的 published 匿名详情 404', await publicDetailStatus('sm_expired'), 404)

    // 打开后台「已失效」面板会触发一次归档（幂等）
    const inv = await api('/api/admin/token-deals?view=invalid&limit=100', { cookie: admin })
    check('后台已失效面板可访问', inv.status === 200, `status=${inv.status}`)
    const row = rowOf('sm_expired')
    checkEq('归档后 state = invalid', row?.state, 'invalid')
    checkEq('失效原因为 expired', row?.invalid_reason, 'expired')
    check('失效时间取的是**到期时刻**而非归档时刻',
      row?.invalid_at === past, `invalid_at=${row?.invalid_at} 期望=${past}`)
  }

  // ═══ ⑫ 双写自洽性与统计口径 ═══
  console.log('\n▶ ⑫ 双写自洽性 + 后台统计口径')
  {
    const bad = withDb(db => db.prepare(`
      SELECT COUNT(*) AS c FROM token_deals
      WHERE (state = 'published' AND (deleted_at IS NOT NULL OR invalid_at IS NOT NULL))
         OR (state = 'deleted'   AND deleted_at IS NULL)
         OR (state = 'published' AND status <> 'approved')
         OR (state = 'pending'   AND status <> 'pending')
         OR (state = 'rejected'  AND status <> 'rejected')
    `).get().c)
    checkEq('state 与旧四列零不自洽', bad, 0)
    checkEq('integrity_check = ok', withDb(db => db.prepare('PRAGMA integrity_check').get()).integrity_check, 'ok')

    const now = Date.now()
    const expect = withDb(db => ({
      published: db.prepare("SELECT COUNT(*) c FROM token_deals WHERE state='published' AND (expires_at IS NULL OR expires_at > ?)").get(now).c,
      pending: db.prepare("SELECT COUNT(*) c FROM token_deals WHERE state='pending' AND (expires_at IS NULL OR expires_at > ?)").get(now).c,
      verified: db.prepare("SELECT COUNT(*) c FROM token_deals WHERE state='verified' AND (expires_at IS NULL OR expires_at > ?)").get(now).c,
      invalid: db.prepare("SELECT COUNT(*) c FROM token_deals WHERE state='invalid' AND COALESCE(invalid_reason,'') <> 'expired'").get().c,
      expired: db.prepare("SELECT COUNT(*) c FROM token_deals WHERE state='invalid' AND COALESCE(invalid_reason,'') = 'expired'").get().c,
      deleted: db.prepare("SELECT COUNT(*) c FROM token_deals WHERE state='deleted'").get().c,
    }))
    const stats = (await api('/api/admin/stats', { cookie: admin })).json || {}
    const td = stats.tokenDeals || {}
    checkEq('stats.tokenDeals 存在', typeof td, 'object')
    checkEq('stats.published 与实际一致', td.published, expect.published)
    checkEq('stats.pending 与实际一致', td.pending, expect.pending)
    checkEq('stats.verified 与实际一致（新档）', td.verified, expect.verified)
    checkEq('stats.deleted 与实际一致', td.deleted, expect.deleted)
    checkEq('stats.invalid 与实际一致', td.invalid, expect.invalid)
    checkEq('stats.expired 与实际一致', td.expired, expect.expired)
    checkEq('★ 兼容字段 approved 仍等于 published（老读法不破）', td.approved, td.published)

    // 后台列表的 state 分布
    const q = await api('/api/admin/token-deals?status=published&limit=100', { cookie: admin })
    check('后台 published 队列每行 state 都是 published',
      (q.json?.deals || []).length > 0 && (q.json?.deals || []).every(d => d.state === 'published'),
      `样本 ${(q.json?.deals || []).length}`)
    const qv = await api('/api/admin/token-deals?status=verified&limit=100', { cookie: admin })
    check('后台 verified 队列每行 state 都是 verified',
      (qv.json?.deals || []).every(d => d.state === 'verified'),
      `样本 ${(qv.json?.deals || []).length}`)

    // 公开列表绝不混入非 published
    const pub = await api('/api/token-deals?limit=100')
    const states = [...new Set((pub.json?.deals || []).map(d => d.state))]
    checkEq('公开列表只含 published', states, ['published'])
  }

  // ═══ ⑬ 回填的两面：既自愈旧行，又不碰人工档位 ═══
  //
  // 这一组针对一个**真实发生过的 bug**：回填按旧列重算，而 offline 行双写的
  // status 仍是 'approved' → 每次容器重启都被算成 published，下架的条目
  // 悄悄重新上线。
  //
  // 断言必须走**真实重启**（重跑迁移），不能在这里复制一份 SQL ——
  // 复制品测不出实现里的漏写，而那正是这个 bug 的成因。
  console.log('\n▶ ⑬ 回填：自愈旧行 + 不碰人工档位')
  {
    // ── A. 人工档位必须先造出来 ──
    await api(`/api/admin/token-deals/${idAdmin}/state`, {
      method: 'PUT', cookie: admin, body: { state: 'offline' },
    })
    checkEq('准备：idAdmin 置为 offline', stateOf(idAdmin), 'offline')
    await api(`/api/admin/token-deals/${idUser}/state`, {
      method: 'PUT', cookie: admin, body: { state: 'verified' },
    })
    checkEq('准备：idUser 置为 verified', stateOf(idUser), 'verified')

    // 造一条「只有旧列」的行 —— 模拟运营脚本直连库导入、只写了 status 的情况。
    // 它的 state 停在列默认值 'pending'，属于需要被自愈的对象。
    const legacyId = 'sm_legacy_row'
    withDb(db => db.prepare(`
      INSERT INTO token_deals (id, user_id, provider, title, url, models, region, quality,
        source_tag, category, status, note, pinned, created_at, updated_at)
      VALUES (?, 0, '旧列导入服务商', '旧列导入通告', 'https://example.com/legacy', '[]',
        'cn', '中品', 'official', 'token', 'approved', 'x', 0, ?, ?)
    `).run(legacyId, Date.now(), Date.now()))
    checkEq('旧列导入的行 state 停在默认值 pending', stateOf(legacyId), 'pending')

    // ── B. 重启 → 回填跑一遍 ──
    await stopApp()
    await startApp()

    checkEq('★ 重启后 offline 仍是 offline（修复前会变 published）', stateOf(idAdmin), 'offline')
    checkEq('★ 重启后 verified 仍是 verified', stateOf(idUser), 'verified')
    checkEq('offline 仍不对外', await publicDetailStatus(idAdmin), 404)
    checkEq('★ 只写旧列的行被自愈为 published', stateOf(legacyId), 'published')
    check('自愈后的行公开可见', await inPublicList(legacyId))

    // ── C. 再重启一次，结果稳定（幂等）──
    await stopApp()
    await startApp()
    checkEq('再重启：offline 依然 offline', stateOf(idAdmin), 'offline')
    checkEq('再重启：verified 依然 verified', stateOf(idUser), 'verified')
    checkEq('再重启：自愈的行依然 published', stateOf(legacyId), 'published')
    checkEq('全库 state 与旧列仍然零不自洽', withDb(db => db.prepare(`
      SELECT COUNT(*) AS c FROM token_deals
      WHERE (state = 'published' AND (deleted_at IS NOT NULL OR invalid_at IS NOT NULL))
         OR (state = 'deleted'   AND deleted_at IS NULL)
         OR (state = 'offline'   AND status <> 'approved')
         OR (state = 'verified'  AND status <> 'approved')
    `).get().c), 0)
  }


  await stopApp()
  console.log(`\n═══ 结果：${passCount} 通过 / ${failCount} 失败 ═══`)
  if (failCount) {
    console.log('\n失败项：')
    for (const f of failures) console.log('  · ' + f)
  }
  try { rmSync(WORK, { recursive: true, force: true }) } catch { /* 忽略 */ }
  process.exit(failCount ? 1 : 0)
}

main().catch(async (err) => {
  console.error('\n脚本异常：', err)
  try { await stopApp() } catch { /* 忽略 */ }
  try { rmSync(WORK, { recursive: true, force: true }) } catch { /* 忽略 */ }
  process.exit(1)
})
