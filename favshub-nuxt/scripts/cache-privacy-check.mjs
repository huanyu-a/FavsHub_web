#!/usr/bin/env node
/**
 * cache-privacy-check.mjs — 断言「按 Cookie 定制的伪静态详情页绝不被判为可共享缓存」
 *
 * 背景（2026-10-30 第三轮复核实测）：
 *   `/tokens/<id>.html` 的 SSR HTML 是按 Cookie 定制的（is_owner / can_edit / my_vote /
 *   my_review / guest_review / 评测的 my_marked），因此必须保持 `private` + `Vary: Cookie`。
 *   但同一张页面有多种**等价写法**（尾斜杠、结尾 `/.`、百分号编码 `%2Ehtml` / `%5F` / `%64eal`），
 *   而 vue-router 是先解码再匹配路由参数的 —— 按未解码原串做精确正则匹配时，
 *   这些写法会绕过豁免、掉进「游客 → public」分支。实测 5 种写法可绕过。
 *
 * 修法是「归一化后再判 + 以 .html 结尾一律 private」（后缀规则，不再枚举具体路由），
 * 本脚本就是这条不变量的常驻检测器：**同一页面的任何等价写法，缓存判定必须一致**。
 *
 * 用法：node scripts/cache-privacy-check.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3255
const BASE = `http://127.0.0.1:${APP_PORT}`

let pass = 0
const fails = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.error('  ✗', name, detail) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const DEAL_ID = 'deal_cacheprivacy_0001'
let appProcess = null

function ensureNativeModule() {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  const load = () => { try { requireFromRoot('better-sqlite3'); return true } catch { return false } }
  if (!load()) {
    spawnSync('pnpm', ['rebuild', 'better-sqlite3'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (!load()) throw new Error('better-sqlite3 无法加载')
  }
}

async function startApp(dbPath) {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 pnpm build'); process.exit(1) }
  ensureNativeModule()
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), NUXT_DB_PATH: dbPath, NUXT_ADMIN_USERS: 'cacheadmin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => console.error(`  [app] ${String(d).trim().slice(0, 300)}`))
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    try { const r = await fetch(`${BASE}/api/announcements`); if (r.ok) return } catch { /* 等就绪 */ }
    await sleep(500)
  }
  throw new Error('应用 30s 内未就绪')
}

async function get(path, cookie) {
  const res = await fetch(BASE + path, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  })
  return {
    status: res.status,
    cc: res.headers.get('cache-control') || '',
    vary: res.headers.get('vary') || '',
  }
}

try {
  mkdirSync(join(ROOT, 'data'), { recursive: true })
  const dbPath = join(ROOT, 'data', `cache-privacy-${Date.now()}.db`)
  console.log(`▶ 启动应用（PORT=${APP_PORT}）`)
  await startApp(dbPath)

  // 插一条真实通告：路径能匹配到具体详情页，而不是 404 分支
  {
    const requireFromRoot = createRequire(join(ROOT, 'package.json'))
    const Database = requireFromRoot('better-sqlite3')
    const db = new Database(dbPath)
    const now = Date.now()
    try {
      db.prepare(`
        INSERT INTO token_deals (id, user_id, provider, title, url, call_url, quota, models,
          region, quality, source_tag, category, status, note, created_at, updated_at)
        VALUES (?, 0, 'CacheProbe', '缓存隐私探针', 'https://example.com/c', '', '', '[]',
          'cn', '中品', 'official', 'token', 'approved', 'x', ?, ?)
      `).run(DEAL_ID, now, now)
    } finally { db.close() }
  }

  // ── 1. 同一张详情页的所有等价写法，缓存判定必须一致（都要 private）──
  const spellings = [
    ['规范形态', `/tokens/${DEAL_ID}.html`],
    ['尾斜杠', `/tokens/${DEAL_ID}.html/`],
    ['多个尾斜杠', `/tokens/${DEAL_ID}.html///`],
    ['结尾 /.', `/tokens/${DEAL_ID}.html/.`],
    ['下划线百分号编码', `/tokens/${DEAL_ID.replace(/_/g, '%5F')}.html`],
    ['后缀百分号编码（%2Ehtml）', `/tokens/${DEAL_ID}%2Ehtml`],
    ['首字母百分号编码（%64eal）', `/tokens/%64eal${DEAL_ID.slice(4)}.html`],
    ['重复斜杠', `/tokens//${DEAL_ID}.html`],
  ]

  console.log('\n▶ 伪静态详情页的等价写法（都不得为 public）')
  for (const [label, p] of spellings) {
    const r = await get(p)
    if (r.status !== 200) {
      // 非 200 的写法不渲染页面，无泄露面；但请记下来，不要静默当通过
      console.log(`  · ${label} ${p} → HTTP ${r.status}（不渲染页面，跳过）`)
      continue
    }
    check(`${label} 保持 private`, !/public/i.test(r.cc), `cache-control="${r.cc}"`)
    check(`${label} 保留 Vary: Cookie`, /cookie/i.test(r.vary), `vary="${r.vary}"`)
  }

  // ── 2. 已登录视角同样是 private（不能因为带了 cookie 就换一套判定）──
  console.log('\n▶ 带认证 cookie 的详情页')
  {
    const r = await get(`/tokens/${DEAL_ID}.html`, 'favshub_token=invalid-but-present')
    check('带 token cookie 时保持 private', !/public/i.test(r.cc), `cache-control="${r.cc}"`)
  }

  // ── 3. 公开列表页仍可被共享缓存（确认没有过度豁免、没把缓存设计一刀切掉）──
  console.log('\n▶ 公开页面应仍可被共享缓存（防止「修安全顺手废掉缓存」）')
  for (const p of ['/', '/tokens', '/prompts', '/collections', '/tokens/keys']) {
    const r = await get(p)
    check(`${p} 游客可 public 缓存`, r.status === 200 && /public/i.test(r.cc) && /s-maxage=\d+/.test(r.cc),
      `status=${r.status} cache-control="${r.cc}"`)
  }

  // ── 4. 明确禁缓存的路径不受影响 ──
  console.log('\n▶ 明确禁缓存的路径')
  for (const p of ['/login', '/admin']) {
    const r = await get(p)
    check(`${p} 不得为 public`, !/public/i.test(r.cc), `cache-control="${r.cc}"`)
  }
} catch (err) {
  fails.push(`执行异常：${err.message}`)
} finally {
  if (appProcess) { appProcess.kill('SIGTERM'); await sleep(300); if (!appProcess.killed) appProcess.kill('SIGKILL') }
}

if (fails.length) {
  console.error(`\n✗ 失败 ${fails.length} 项：`)
  for (const f of fails) console.error('  - ' + f)
}
console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
process.exit(fails.length ? 1 : 0)
