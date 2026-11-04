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
let dbPath = ''
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
  dbPath = join(ROOT, 'data', `cache-privacy-${Date.now()}.db`)
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

  // 种一条「元数据里混进明文 key」的福利 Key 记录 —— 2026-11-05 线上实测的真实数据形态：
  // source_title 里带一把完整明文 key、base_url 里带另一把。列表响应与 SSR HTML 都不得外流。
  // ⚠️ 合成串必须**真的匹配** key-redact 的前缀规则（sk- / gsk_ / nvapi- …），
  //    否则脱敏根本不触发、测的是「没命中」而不是「命中了且被脱敏」。
  //    刻意不用 `{{...}}` 形式，避免被当成占位符替换掉。
  const LEAK_TITLE = 'sk-PROBELEAK0123456789ghij'
  const LEAK_BASE = 'nvapi-PROBELEAK9876543210zyxwvutsrq'
  const REDACTED_TITLE = 'sk-PRO…ghij'
  const REDACTED_BASE = 'nvapi-…tsrq'
  const KEY_ID = 'key_cacheprivacy_0001'
  {
    const requireFromRoot = createRequire(join(ROOT, 'package.json'))
    const Database = requireFromRoot('better-sqlite3')
    const db = new Database(dbPath)
    const now = Math.floor(Date.now() / 1000)
    try {
      db.prepare(`
        INSERT INTO token_keys (id, key_masked, key_hash, key_plain, base_url, provider,
          source_title, source_url, source, confidence, verdict, deal_status,
          first_seen_at, post_time, created_at, updated_at)
        VALUES (?, 'sk-AAA**********************bbbb', 'probehash',
          'sk-PLAINPROBE0123456789wxyz',
          ?, 'probe.example.com', ?, 'https://example.com/topic/1',
          'post', 'high', 'valid', 'published', ?, '2026-11-05 10:00', ?, ?)
      `).run(KEY_ID, LEAK_BASE, LEAK_TITLE, now, now, now)
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

  // ── 5. 密钥形态串不得经公开出口外流 ──
  // 2026-11-05 线上实测发现：`source_title` 里混进过一把完整的 51 字符明文 key，
  // 它随列表响应下发、并经 SSR 进入页面 HTML（页面里出现 2 处），
  // 而同一条记录的 `key_masked` 是掩码形态 —— 即**绕过了「明文 key 不进列表响应」
  // 这条设计控制**。旧实现只对 `base_url` 做了遮蔽，`source_title` / `source_url`
  // 没有被覆盖（正则散在多个文件里，各自为政）。
  console.log('\n▶ 密钥形态串脱敏（source_title / base_url 不得外流明文）')
  {
    const apiText = await (await fetch(`${BASE}/api/token-keys?limit=100`)).text()
    const pageText = await (await fetch(`${BASE}/tokens/keys`)).text()

    check('列表接口不含 source_title 里的明文 key', !apiText.includes(LEAK_TITLE),
      '明文 key 出现在 /api/token-keys 响应里')
    check('列表接口不含 base_url 里的明文 key', !apiText.includes(LEAK_BASE),
      '明文 key 出现在 /api/token-keys 响应里')
    check('页面 HTML 不含 source_title 里的明文 key', !pageText.includes(LEAK_TITLE),
      '明文 key 出现在 /tokens/keys 的 SSR HTML 里')
    check('页面 HTML 不含 base_url 里的明文 key', !pageText.includes(LEAK_BASE),
      '明文 key 出现在 /tokens/keys 的 SSR HTML 里')

    // ⚠️ 这四条是上面断言能成立的前提：**探针行确实被返回了**。
    //    否则「响应里没有明文 key」可能只是因为这行压根没进列表 —— 假绿。
    //    所以必须同时证明：探针行在场，且它的值是被**替换**成了掩码形态。
    check('探针行确实出现在列表响应里（否则上一条是假绿）',
      apiText.includes(KEY_ID) || apiText.includes('probe.example.com'),
      '探针行未出现在 /api/token-keys 响应中，上面的「不含明文 key」不构成证据')
    check('source_title 已被替换为掩码形态',
      apiText.includes(REDACTED_TITLE),
      `未找到掩码形态 ${REDACTED_TITLE}，脱敏可能没生效而只是行缺失`)
    check('base_url 已被替换为掩码形态',
      apiText.includes(REDACTED_BASE),
      `未找到掩码形态 ${REDACTED_BASE}`)
  }
} catch (err) {
  fails.push(`执行异常：${err.message}`)
} finally {
  if (appProcess) { appProcess.kill('SIGTERM'); await sleep(300); if (!appProcess.killed) appProcess.kill('SIGKILL') }
  // 清理临时库（含 WAL/SHM 边车），避免在 data/ 里越攒越多
  try {
    const { rmSync } = await import('node:fs')
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
  } catch { /* 清理失败不影响验收结论 */ }
}

if (fails.length) {
  console.error(`\n✗ 失败 ${fails.length} 项：`)
  for (const f of fails) console.error('  - ' + f)
}
console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
process.exit(fails.length ? 1 : 0)
