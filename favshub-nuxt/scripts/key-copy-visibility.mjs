#!/usr/bin/env node
/**
 * key-copy-visibility.mjs — 「福利 Key」复制端点的可见性契约
 *
 * ## 为什么要单开一个套件
 *
 * `GET /api/token-keys/:id/copy` 是全站**唯一下发明文密钥**的接口（2026-10-08 设计变更：
 * 列表/详情的 SELECT 列清单里根本没有 key_plain，明文只在这里按需取一次写进剪贴板）。
 * 也就是说：这个接口的守卫一旦失守，泄漏的是**可用的真实密钥**，而不是元数据。
 *
 * 而在此之前它**零测试覆盖** —— 全仓 12 个套件、1200+ 断言，没有一个提到 copy 端点。
 * 本脚本把它的可见性契约钉成常驻断言。
 *
 * ## 契约（handler 头部注释声称的，本脚本逐条验证）
 *
 * 1. 只有 `deal_status='published'` 且 `verdict != 'dead'` 的行可复制；
 * 2. 回帖指引行（C 类 `reply_visible_guide`）**不可复制** —— 它们只带「去原帖回复领取」的
 *    指引，没有任何 key 数据（2026-11-05 核对生产：29 条指引行，有明文 0 条、有掩码 0 条）；
 * 3. 无任何 key 数据的行不可复制；
 * 4. **不区分「不存在」与「不可见」** —— 避免存在性泄露；
 * 5. 绝不入缓存；
 * 6. 与列表的**有意差异**：完整 `base_url` 由本端点下发（列表给的是遮蔽版）——
 *    因为部分站点「URL 即 key」，遮蔽版没有使用价值。这条差异是设计，不是缺陷，
 *    但必须被断言固定住，否则日后有人「顺手统一」就会废掉复制功能。
 *
 * 用法：node scripts/key-copy-visibility.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3257
const BASE = `http://127.0.0.1:${APP_PORT}`

let pass = 0
const fails = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.error('  ✗', name, detail) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 探针行的 key 明文。
 *
 * ⚠️ 两点都是刻意的：
 *   1. 必须是能匹配密钥前缀规则的**真实形态**（`sk-` + 足够长的尾段），
 *      否则断言测的是「没有命中」而不是「命中了且按契约处理」；
 *   2. 纯合成串、**不含花括号** —— 双花括号那种占位符写法会在别处被替换掉，
 *      让断言悄悄测了个空（`cache-privacy-check.mjs` 里也记着同一条坑）。
 */
const OK_PLAIN = 'sk-probe-0000-1111-2222-3333-4444'
const OK_BASE = 'https://copy-probe.example.com/v1/' + OK_PLAIN
const ROWS = {
  ok: 'keycopy_ok_0001',
  pending: 'keycopy_pending_0001',
  dead: 'keycopy_dead_0001',
  guide: 'keycopy_guide_0001',
  nokey: 'keycopy_nokey_0001',
  absent: 'keycopy_absent_0001',
}

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
    env: { ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), NUXT_DB_PATH: dbPath },
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

/** 取响应：状态码、缓存头、以及原始文本（用于比较 404 文案是否一致） */
async function getCopy(id) {
  const res = await fetch(`${BASE}/api/token-keys/${id}/copy`, { redirect: 'manual' })
  return {
    status: res.status,
    cc: res.headers.get('cache-control') || '',
    vary: res.headers.get('vary') || '',
    body: await res.text(),
  }
}

/** 把响应体归一化成「错误文案」，用于比较不同 404 是否可区分 */
function errorMessage(body) {
  try { return String(JSON.parse(body)?.data?.error ?? JSON.parse(body)?.error ?? '') } catch { return '' }
}

try {
  mkdirSync(join(ROOT, 'data'), { recursive: true })
  dbPath = join(ROOT, 'data', `key-copy-${Date.now()}.db`)
  console.log(`▶ 启动应用（PORT=${APP_PORT}）`)
  await startApp(dbPath)

  // 种探针行 —— 覆盖契约里的每一种可见性分支
  {
    const requireFromRoot = createRequire(join(ROOT, 'package.json'))
    const Database = requireFromRoot('better-sqlite3')
    const db = new Database(dbPath)
    const now = Math.floor(Date.now() / 1000)   // token_keys 是**秒**级（与 token_deals 的毫秒不同）
    const ins = db.prepare(`
      INSERT INTO token_keys (id, key_masked, key_hash, key_plain, base_url, provider,
        source_title, source_url, source, confidence, verdict, deal_status,
        first_seen_at, post_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'probe.example.com', 'copy 探针', 'https://example.com/topic/1',
        ?, 'high', ?, ?, ?, '2026-11-05 10:00', ?, ?)
    `)
    try {
      const MASKED = 'sk-PRO********************ghij'
      const rows = [
        // 可复制：published + valid + post + 有明文
        [ROWS.ok, MASKED, 'hash-ok', OK_PLAIN, OK_BASE, 'post', 'valid', 'published'],
        // 待审：deal_status 非 published
        [ROWS.pending, MASKED, 'hash-pending', OK_PLAIN, OK_BASE, 'post', 'valid', 'pending'],
        // 失效：verdict = dead
        [ROWS.dead, MASKED, 'hash-dead', OK_PLAIN, OK_BASE, 'post', 'dead', 'published'],
        // 回帖指引行：即便在 24h 窗口内也不可复制（它本来就没有 key）
        [ROWS.guide, '', 'hash-guide', '', 'https://example.com/topic/guide', 'reply_visible_guide', 'valid', 'published'],
        // 有可见性但没有任何 key 数据
        [ROWS.nokey, '', 'hash-nokey', '', '', 'post', 'valid', 'published'],
      ]
      for (const r of rows) {
        const [id, masked, hash, plain, baseurl, source, verdict, dealStatus] = r
        ins.run(id, masked, hash, plain, baseurl, source, verdict, dealStatus, now, now, now)
      }
    } finally { db.close() }
  }

  // ── 1. 可复制的行 ──
  console.log('\n▶ 可复制的行（published + 非 dead + 非指引 + 有 key）')
  const okRes = await getCopy(ROWS.ok)
  check('返回 200', okRes.status === 200, `status=${okRes.status}`)
  let okBody = {}
  try { okBody = JSON.parse(okRes.body) } catch { /* 下面按字段断言会失败 */ }
  check('下发明文 key_plain', okBody.key_plain === OK_PLAIN,
    `拿到 ${JSON.stringify(String(okBody.key_plain || '').slice(0, 20))}`)
  check('下发完整 base_url（列表给的是遮蔽版）', okBody.base_url === OK_BASE,
    `拿到 ${JSON.stringify(String(okBody.base_url || '').slice(0, 40))}`)

  // ── 2. 绝不入缓存 ──
  console.log('\n▶ 明文端点绝不入缓存')
  check('Cache-Control 含 no-store', /no-store/i.test(okRes.cc), `cache-control="${okRes.cc}"`)
  check('Cache-Control 不含 public', !/public/i.test(okRes.cc), `cache-control="${okRes.cc}"`)
  check('带 Vary: Cookie', /cookie/i.test(okRes.vary), `vary="${okRes.vary}"`)

  // ── 3. 各拒绝分支一律 404 ──
  console.log('\n▶ 拒绝分支')
  const denied = [
    ['待审行（deal_status=pending）', ROWS.pending],
    ['失效行（verdict=dead）', ROWS.dead],
    ['回帖指引行（24h 窗口内）', ROWS.guide],
    ['无任何 key 数据的行', ROWS.nokey],
    ['不存在的 id', ROWS.absent],
  ]
  const deniedRes = {}
  for (const [label, id] of denied) {
    const r = await getCopy(id)
    deniedRes[label] = r
    check(`${label} → 404`, r.status === 404, `status=${r.status}`)
  }

  // ── 4. 不区分「不存在」与「不可见」（避免存在性泄露）──
  console.log('\n▶ 不区分「不存在」与「不可见」')
  {
    const msgs = new Map()
    for (const [label, r] of Object.entries(deniedRes)) {
      const m = errorMessage(r.body)
      if (!msgs.has(m)) msgs.set(m, [])
      msgs.get(m).push(label)
    }
    check('所有拒绝分支的 404 文案完全一致',
      msgs.size === 1,
      [...msgs.entries()].map(([m, ls]) => `「${m}」← ${ls.join(' / ')}`).join('；'))
  }

  // ── 5. id 格式校验 ──
  // 注意分清两层，别把「路由没匹配上」当成「handler 校验生效」：
  //   - **字面**斜杠（`a/b`）段数对不上 `:id`，根本到不了 handler，由路由层直接 404；
  //   - **编码**斜杠（`a%2Fb`）不会被当作路径分隔符，它**到达 handler** 并由正则拦下 → 400
  //     （实测确认 —— 这一点很容易想当然判错，编码斜杠正是常见的路径探测形态，
  //      能到 handler 并被拒才是想要的）；
  //   - 其余能到达 handler 的非法形态（`.`/`!`/空格/超长）同样由正则拦下 → 400。
  console.log('\n▶ id 格式校验')
  for (const [label, id] of [
    ['含点号', 'a.b'],
    ['含感叹号', 'a!b'],
    ['含空格（编码）', 'a%20b'],
    ['斜杠（编码，仍到 handler）', 'a%2Fb'],
    ['反斜杠（编码）', 'a%5Cb'],
    ['超长（81 字符）', 'x'.repeat(81)],
  ]) {
    const r = await getCopy(id)
    check(`${label} 的 id → 400（handler 正则拦下）`, r.status === 400, `status=${r.status}`)
  }
  {
    const r = await getCopy('a/b')
    check('字面斜杠的 id → 404（段数不符，未到 handler，属预期）', r.status === 404, `status=${r.status}`)
  }

  // ── 6. 复制计数 +1（站点本地热度，页面「已复制 N 次」）──
  console.log('\n▶ 复制计数')
  {
    const before = await getCopy(ROWS.ok)
    const after = await getCopy(ROWS.ok)
    check('两次可复制请求都成功', before.status === 200 && after.status === 200)
    // 计数是异步 best-effort，直接查库更可靠
    const requireFromRoot = createRequire(join(ROOT, 'package.json'))
    const Database = requireFromRoot('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    try {
      const n = db.prepare('SELECT copy_count FROM token_keys WHERE id = ?').get(ROWS.ok)?.copy_count
      check('copy_count 已累加（≥ 前面成功的次数）', Number(n) >= 3, `copy_count=${n}`)
    } finally { db.close() }
  }

  // ── 7. 与列表的**有意差异**：列表遮蔽 base_url，copy 给完整的 ──
  // 这条差异是设计（「URL 即 key」的站点复制遮蔽版没有意义），不能被人「顺手统一」掉。
  console.log('\n▶ 列表遮蔽 / copy 完整 —— 有意差异')
  {
    const listText = await (await fetch(`${BASE}/api/token-keys?limit=100`)).text()
    check('列表里 base_url 是遮蔽版（含 …）',
      listText.includes('sk-PRO…') || !listText.includes(OK_BASE),
      '列表未遮蔽 base_url')
    check('列表里不含完整明文 key', !listText.includes(OK_PLAIN),
      '完整明文 key 出现在列表响应里')
    check('copy 端点给的是完整 base_url（与列表相反的契约）',
      String(okBody.base_url || '') === OK_BASE)
  }
} catch (err) {
  fails.push(`执行异常：${err.message}`)
} finally {
  if (appProcess) { appProcess.kill('SIGTERM'); await sleep(300); if (!appProcess.killed) appProcess.kill('SIGKILL') }
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
