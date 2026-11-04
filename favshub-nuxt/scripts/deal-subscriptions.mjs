#!/usr/bin/env node
/**
 * deal-subscriptions.mjs — 游客订阅的生命周期契约
 *
 * ## 为什么要这个套件
 *
 * `/api/deal-subscriptions/**` 是**游客可写 + 发放能力令牌**的面：不需要账号，
 * 凭 `sub_token` 就能读/改/退自己的订阅。此前它**零行为覆盖**
 * （`deal-subscriptions` 与 `settings`、`tdk` 是仅有的三个「没有任何套件提到」的前缀）。
 *
 * 本套件把它的对外契约钉死：
 *
 *   - 创建：token 形态、脱敏展示、label/过滤条件的截断上限、缓存头
 *   - 404 一致性：不存在的 / 过短的 / 已退订的 token，在 GET/PATCH/DELETE 上
 *     **文案必须逐字节相同** —— 否则就是一个「这个 token 存在吗」的探测器
 *   - PATCH 只允许改 label / filters / status(active|paused)，其余一律 400
 *   - DELETE 之后所有路径都 404
 *   - 限流：每 IP 每天 N 条（创建）、60 次/小时（读写），且 **IPv6 按 /64 聚合**
 *   - 总闸门 `deal_sub_enabled=false` 让 4 个端点一起 404
 *
 * ## 关于 IPv6 /64 聚合的两个断言（1.0.93 修的那处）
 *
 * `index.post` 一开始就用 `rateKeyForIp` 把 IPv6 收敛到 /64，注释里也写明理由：
 * 「否则换一个地址就能重置配额」。但 `[token].get/patch/delete` 用的是**原始地址**，
 * 同一个 /64 内换地址就能重置 60 次/小时的配额 —— 同样的道理没做。
 *
 * 第 5、6 组就是钉这一点：同一 /64 内换地址**必须**共享配额（会 429），
 * 换一个 /64 **必须**拿到独立配额（会 200）。后一条是前一条的对照 ——
 * 少了它，「共享配额」可能是因为限流根本就是全局的，那样断言就没意义。
 *
 * 这些请求靠 `X-Real-IP` 伪造来源：站点部署在 nginx 后面、容器端口不对外发布，
 * 所以 `getClientIP` 信任来自私网对端的 `X-Real-IP` 是**设计**（见 verify-edge-ip-integrity.sh）。
 *
 * ## 防假绿护栏（沿用另外两个套件的做法，都是被咬过之后加的）
 *
 *   1. **端口必须先空闲** —— 否则测到的是残留实例、读的是**旧库**，会「全绿」地骗人。
 *   2. **种的数据必须可见** —— 建完订阅立刻用它的 token 读一次，证明应用读的就是这个库。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// 独占端口 3270（3210-3277 里未被其他套件占用）
const APP_PORT = 3270
const BASE = `http://127.0.0.1:${APP_PORT}`

let pass = 0
const fails = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.error('  ✗', name, detail) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let dbPath = ''
let appProcess = null
const req = () => createRequire(join(ROOT, 'package.json'))

async function hit(method, path, opts = {}) {
  const headers = {}
  if (opts.ip) headers['x-real-ip'] = opts.ip
  if (method !== 'GET') headers['content-type'] = 'application/json'
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
      redirect: 'manual', signal: ac.signal,
    })
    return {
      status: res.status, text: await res.text(),
      cc: res.headers.get('cache-control'), vary: res.headers.get('vary'),
    }
  } catch (e) {
    return { status: 0, text: 'TIMEOUT:' + (e?.name || 'unknown'), cc: null, vary: null }
  } finally { clearTimeout(timer) }
}
const json = (r) => { try { return JSON.parse(r.text) } catch { return {} } }
const setConfig = (k, v) => {
  const Database = req()('better-sqlite3')
  const db = new Database(dbPath)
  try { db.prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)').run(k, v) } finally { db.close() }
}

try {
  mkdirSync(join(ROOT, 'data'), { recursive: true })
  dbPath = join(ROOT, 'data', `deal-sub-${Date.now()}.db`)

  // 护栏1：端口必须先空闲
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })
    if (r.ok) {
      console.error(`  ✗ 护栏1 端口 ${APP_PORT} 已被占用（残留实例）。拒绝在旧库上得出结论。`)
      process.exit(1)
    }
  } catch { /* 空闲 */ }
  check('护栏1 端口空闲（避免测到残留实例的旧库）', true)

  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 pnpm build'); process.exit(1) }
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), NUXT_DB_PATH: dbPath,
      // 抬高**站点层**限流以便专测本模块自己的限流（否则 429 到底是谁发的不清楚）
      FAVSHUB_RL_SITE_READ_PER_MIN: '100000',
      FAVSHUB_RL_SITE_WRITE_PER_MIN: '100000',
      FAVSHUB_RL_SITE_CONCURRENCY: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => console.error(`  [app] ${String(d).trim().slice(0, 200)}`))
  {
    const start = Date.now()
    let up = false
    while (Date.now() - start < 30_000) {
      try { const r = await fetch(`${BASE}/api/announcements`); if (r.ok) { up = true; break } } catch { /* 等 */ }
      await sleep(500)
    }
    if (!up) throw new Error('应用 30s 内未就绪')
  }
  {
    const Database = req()('better-sqlite3')
    let ready = false
    for (let i = 0; i < 60; i++) {
      try {
        const db = new Database(dbPath, { readonly: true })
        const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()
        db.close(); if (t) { ready = true; break }
      } catch { /* 还没建 */ }
      await sleep(500)
    }
    if (!ready) throw new Error('30s 内未见 users 表，迁移可能失败')
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第1组：创建订阅的对外契约')
  // ══════════════════════════════════════════════════════════════
  const IP_A = '203.0.113.7'
  let TOKEN = ''
  {
    const r = await hit('POST', '/api/deal-subscriptions', {
      ip: IP_A,
      body: {
        label: 'x'.repeat(80),
        filters: {
          kinds: ['online', 'bogus_kind'],
          providers: ['a'],
          keywords: Array.from({ length: 30 }, (_, i) => 'k' + i),
        },
      },
    })
    check('POST 创建 → 200', r.status === 200, `status=${r.status} ${r.text.slice(0, 120)}`)
    const b = json(r)
    TOKEN = String(b.sub_token || '')
    check('sub_token 是 64 位十六进制（256 bit，不可猜）', /^[0-9a-f]{64}$/.test(TOKEN), `实际=${TOKEN.slice(0, 12)}…(${TOKEN.length})`)
    check('响应带 Cache-Control: no-store（含能力令牌，不得被缓存）',
      String(r.cc || '').includes('no-store'), `cc=${r.cc}`)
    check('响应带 Vary: Cookie', String(r.vary || '').includes('Cookie'), `vary=${r.vary}`)
    check('baseline_seq 是数字', typeof b.baseline_seq === 'number', `=${JSON.stringify(b.baseline_seq)}`)

    const view = b.subscription || {}
    check('视图里没有裸 sub_token 字段（token 只出现在顶层 sub_token）',
      !('sub_token' in view), `键: ${Object.keys(view).join(',')}`)
    check('视图给的是脱敏 token（不等于完整 token）',
      !!view.token_masked && view.token_masked !== TOKEN && !String(view.token_masked).includes(TOKEN),
      `token_masked=${view.token_masked}`)
    check('label 被截断到 40 字符', String(view.label || '').length === 40, `长度=${String(view.label || '').length}`)
    check('kinds 走了白名单（非法 kind 被丢弃，合法的保留）',
      Array.isArray(view.filters?.kinds) && view.filters.kinds.includes('online') && !view.filters.kinds.includes('bogus_kind'),
      `kinds=${JSON.stringify(view.filters?.kinds)}`)
    check('keywords 上限 20 条', (view.filters?.keywords || []).length === 20, `条数=${(view.filters?.keywords || []).length}`)
    // 记录既有契约：feed_url / changes_url 里**确实**嵌着完整 token（调用方本来就持有它）
    check('feed_url 里带完整 token（既有契约：方便直接粘进 Hermes）',
      String(view.feed_url || '').includes(TOKEN), `feed_url=${String(view.feed_url || '').slice(0, 60)}`)
    check('changes_url 里带完整 token 且提示了游标占位',
      String(view.changes_url || '').includes(TOKEN) && String(view.changes_url || '').includes('since='),
      `changes_url=${String(view.changes_url || '').slice(0, 70)}`)
  }

  // 护栏2：种的数据必须可见
  {
    const r = await hit('GET', `/api/deal-subscriptions/${TOKEN}`)
    check('护栏2 刚建的订阅立刻可读（证明应用读的就是这个库）', r.status === 200, `status=${r.status}`)
    if (r.status !== 200) throw new Error('刚创建的订阅读不到，后续结论无意义')
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第2组：404 文案必须逐字节一致（不得当「token 存在吗」的探针）')
  // ══════════════════════════════════════════════════════════════
  const BOGUS = 'f'.repeat(64)
  let notFoundText = ''
  {
    const g = await hit('GET', `/api/deal-subscriptions/${BOGUS}`)
    const p = await hit('PATCH', `/api/deal-subscriptions/${BOGUS}`, { body: { label: 'a' } })
    const d = await hit('DELETE', `/api/deal-subscriptions/${BOGUS}`)
    const short = await hit('GET', '/api/deal-subscriptions/abc')
    notFoundText = g.text
    check('GET 不存在的 token → 404', g.status === 404, `status=${g.status}`)
    check('PATCH 不存在的 token → 404', p.status === 404, `status=${p.status}`)
    check('DELETE 不存在的 token → 404', d.status === 404, `status=${d.status}`)
    check('GET 过短的 token → 404', short.status === 404, `status=${short.status}`)
    check('四种情形（不存在×3 方法 + 过短）文案完全一致',
      g.text === p.text && p.text === d.text && d.text === short.text,
      `GET=${g.text.slice(0, 60)} / 过短=${short.text.slice(0, 60)}`)
    check('404 响应不含 token 本身（不回显输入）', !g.text.includes(BOGUS), g.text.slice(0, 120))
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第3组：PATCH 只允许改 label / filters / status')
  // ══════════════════════════════════════════════════════════════
  {
    const ok = await hit('PATCH', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A, body: { status: 'paused' } })
    check('PATCH status=paused → 200', ok.status === 200, `status=${ok.status}`)
    check('PATCH 后状态确实变成 paused', json(ok).subscription?.status === 'paused', `=${json(ok).subscription?.status}`)
    check('PATCH 响应也是 no-store', String(ok.cc || '').includes('no-store'), `cc=${ok.cc}`)

    const back = await hit('PATCH', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A, body: { status: 'active' } })
    check('PATCH status=active → 200（可恢复）', back.status === 200 && json(back).subscription?.status === 'active')

    const bad = await hit('PATCH', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A, body: { status: 'revoked' } })
    check('PATCH status=revoked → 400（退订必须走 DELETE）', bad.status === 400, `status=${bad.status} ${bad.text.slice(0, 80)}`)

    const empty = await hit('PATCH', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A, body: {} })
    check('PATCH 空 body → 400', empty.status === 400, `status=${empty.status}`)

    // 不可改字段：cursor / sub_token / created_ip_hash / id
    const sneak = await hit('PATCH', `/api/deal-subscriptions/${TOKEN}`, {
      ip: IP_A, body: { cursor: 99999, sub_token: 'deadbeef'.repeat(8), created_ip_hash: 'x', id: 'y' },
    })
    check('PATCH 只发不可改字段（cursor/sub_token/created_ip_hash/id）→ 400，不予接受',
      sneak.status === 400, `status=${sneak.status} ${sneak.text.slice(0, 80)}`)
    const after = await hit('GET', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A })
    check('不可改字段确实没被改动（cursor 仍为 0）', json(after).subscription?.cursor === 0,
      `cursor=${json(after).subscription?.cursor}`)

    const lb = await hit('PATCH', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A, body: { label: 'y'.repeat(80) } })
    check('PATCH label 也截断到 40', String(json(lb).subscription?.label || '').length === 40)
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第4组：DELETE 退订后所有路径都 404')
  // ══════════════════════════════════════════════════════════════
  {
    const d = await hit('DELETE', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A })
    check('DELETE 自己的订阅 → 200', d.status === 200, `status=${d.status}`)
    const g = await hit('GET', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A })
    const p = await hit('PATCH', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A, body: { label: 'z' } })
    const d2 = await hit('DELETE', `/api/deal-subscriptions/${TOKEN}`, { ip: IP_A })
    check('退订后 GET → 404', g.status === 404, `status=${g.status}`)
    check('退订后 PATCH → 404', p.status === 404, `status=${p.status}`)
    check('退订后 DELETE 再来一次 → 404', d2.status === 404, `status=${d2.status}`)
    check('退订后的文案与「不存在」逐字节一致（不暴露「曾经存在过」）',
      g.text === notFoundText && p.text === notFoundText, `退订=${g.text.slice(0, 60)}`)
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第5组：创建的限流按 IP 分桶，且 IPv6 按 /64 聚合')
  // ══════════════════════════════════════════════════════════════
  {
    setConfig('deal_sub_per_ip_per_day', '1')
    const a = await hit('POST', '/api/deal-subscriptions', { ip: '2001:db8:a::1', body: { label: 'v6a' } })
    check('IPv6 第 1 次创建 → 200', a.status === 200, `status=${a.status}`)
    const b = await hit('POST', '/api/deal-subscriptions', { ip: '2001:db8:a::2', body: { label: 'v6b' } })
    check('同 /64 内换地址再创建 → 429（配额共享，换地址不能重置）',
      b.status === 429, `status=${b.status}（若为 200，说明限频键没做 /64 聚合）`)
    const c = await hit('POST', '/api/deal-subscriptions', { ip: '2001:db8:b::1', body: { label: 'v6c' } })
    check('换一个 /64 创建 → 200（对照：证明是 /64 聚合，不是全局限流）',
      c.status === 200, `status=${c.status}（若为 429，说明限流是全局的，上一条断言就没有意义）`)
    setConfig('deal_sub_per_ip_per_day', '3')
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第6组：读写的限流也按 IP 分桶 + IPv6 /64 聚合（1.0.93 修的那处）')
  // ══════════════════════════════════════════════════════════════
  {
    const path = `/api/deal-subscriptions/${BOGUS}`
    let last = 200
    for (let i = 0; i < 30; i++) last = (await hit('GET', path, { ip: '2001:db8:c::1' })).status
    check('同 /64 第 1 段 30 次请求未被限流（配额 60）', last === 404, `最后一次 status=${last}`)
    for (let i = 0; i < 30; i++) last = (await hit('GET', path, { ip: '2001:db8:c::2' })).status
    check('同 /64 第 2 段再 30 次仍未限流（累计 60，恰好用完）', last === 404, `最后一次 status=${last}`)
    const over = await hit('GET', path, { ip: '2001:db8:c::3' })
    check('同 /64 第 61 次 → 429（累计配额共享，换地址不能重置）',
      over.status === 429, `status=${over.status}（若为 404，说明限频键用的是原始地址、没做 /64 聚合）`)
    const other = await hit('GET', path, { ip: '2001:db8:d::1' })
    check('换一个 /64 → 404（对照：证明是 /64 聚合，不是全局限流）',
      other.status === 404, `status=${other.status}（若为 429，说明限流是全局的）`)
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第7组：总闸门 deal_sub_enabled=false 让 4 个端点一起 404')
  // ══════════════════════════════════════════════════════════════
  {
    // 先建一个活跃订阅，确保闸门关掉的是「本来能用的」路径（否则 404 可能只是因为 token 不存在）
    const mk = await hit('POST', '/api/deal-subscriptions', { ip: '198.51.100.9', body: { label: 'gate' } })
    const tok = String(json(mk).sub_token || '')
    check('闸门前：新建订阅可读 → 200', (await hit('GET', `/api/deal-subscriptions/${tok}`)).status === 200)
    setConfig('deal_sub_enabled', 'false')
    const gate = [
      ['POST', '/api/deal-subscriptions', { ip: '198.51.100.10', body: {} }],
      ['GET', `/api/deal-subscriptions/${tok}`, {}],
      ['PATCH', `/api/deal-subscriptions/${tok}`, { body: { label: 'a' } }],
      ['DELETE', `/api/deal-subscriptions/${tok}`, {}],
    ]
    for (const [m, p, o] of gate) {
      const r = await hit(m, p, o)
      check(`闸门关闭时 ${m} ${p.replace(tok, '<token>')} → 404`, r.status === 404, `status=${r.status}`)
    }
    // 文案分工是**有意**的，别搞反：
    //   - POST 明确告诉调用方「订阅功能未开放」—— 他去创建时该知道是整体下线，而不是自己参数错了
    //   - 3 个 token 端点仍回那句统一的「不存在或已退订」—— 对拿 token 探测的人**不透露**
    //     功能是否开放，也维持了第 2 组「404 文案必须逐字节一致」的不变量
    const postTxt = await hit('POST', '/api/deal-subscriptions', { ip: '198.51.100.11', body: {} })
    check('闸门关闭时 POST 明确说「订阅功能未开放」（调用方该知道是整体下线）',
      postTxt.status === 404 && postTxt.text.includes('未开放'), `${postTxt.status} ${postTxt.text.slice(0, 80)}`)
    const txt = await hit('GET', `/api/deal-subscriptions/${tok}`)
    check('闸门关闭时 token 端点仍回统一的「不存在或已退订」（不透露功能状态）',
      txt.text === notFoundText, txt.text.slice(0, 90))
    setConfig('deal_sub_enabled', 'true')
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第8组：feed 端点接受活跃 token；无效 token 一致 404')
  // ══════════════════════════════════════════════════════════════
  {
    const mk = await hit('POST', '/api/deal-subscriptions', { ip: '198.51.100.20', body: { label: 'feed' } })
    const tok = String(json(mk).sub_token || '')
    const ch = await hit('GET', `/api/token-deals/changes?token=${tok}`)
    check('changes 带活跃 token → 200', ch.status === 200, `status=${ch.status} ${ch.text.slice(0, 100)}`)
    check('changes 响应是 no-store（个性化内容不得被缓存）',
      String(ch.cc || '').includes('no-store'), `cc=${ch.cc}`)
    const at = await hit('GET', `/api/token-deals/feed.atom?token=${tok}`)
    check('feed.atom 带活跃 token → 200', at.status === 200, `status=${at.status}`)
    const bad = await hit('GET', `/api/token-deals/changes?token=${BOGUS}`)
    check('changes 带无效 token → 404', bad.status === 404, `status=${bad.status}`)
    const noTok = await hit('GET', '/api/token-deals/changes')
    check('changes 不带 token → 200（公共流，任何人可读）', noTok.status === 200, `status=${noTok.status}`)
  }
} catch (err) {
  console.error('\n套件异常：', err?.message || err)
  fails.push(`套件异常：${err?.message || err}`)
} finally {
  if (appProcess) { try { appProcess.kill('SIGTERM') } catch { /* ignore */ } }
  await sleep(500)
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (dbPath) rmSync(dbPath + suffix, { force: true }) } catch { /* ignore */ }
  }
}

console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
if (fails.length) {
  console.error('\n失败明细：')
  for (const f of fails) console.error('  ✗', f)
  process.exit(1)
}
