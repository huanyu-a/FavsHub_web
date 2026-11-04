#!/usr/bin/env node
/**
 * head-injection.mjs — SSR head 的注入契约
 *
 * ## 这个套件守的是什么
 *
 * 站点的 `<head>` 里混进了**两类不受信字符串**：
 *
 *   1. **管理员可控**：`siteTitle / siteDescription / siteKeywords`（`system_config`，经 `/api/tdk`）
 *      → 进 `titleTemplate` 与一串 `meta[].content`
 *   2. **用户/库可控**（门槛低得多）：通告的 `title / provider / summary`、
 *      精选集的 `name / meta_title / meta_description / meta_keywords`
 *      → 进详情页的 `<title>` 与 `og:title` / `description` 等属性
 *
 * 只要有一处没转义，就是**存储型 XSS**：访问该页的每个人都会中招。
 * 转义目前由 unhead 负责 —— 而它是**依赖**，一次升级就可能改变行为。
 * 所以这个契约必须被测试钉住，而不是靠「它一向没事」。
 *
 * ## 我在这里犯过的错（决定了本套件怎么写）
 *
 * 第一版我用 `html.includes('<script>alert(1)</script>')` 判「未转义」，
 * 得到 **3 个假阳性**。看真实的 `<title>`：
 *
 *     <title>&quot;&gt;&lt;script&gt;alert(1)&lt;&#x2F;script&gt;…</title>
 *
 * `" < > /` 全被转义了。而属性里的
 * `content="prov&quot;><script>alert(1)</script> …"` 虽然含**裸** `<script>`，
 * 但它落在**带引号的属性值内** —— 按 HTML 规范是惰性文本，分词器根本不会在那里起标签。
 *
 * 结论：**「原始串是否出现」是错的判据**，正确的判据只有两条：
 *
 *   - 元素文本上下文：`<title>…</title>` 的内容里不许出现裸 `<`
 *   - 属性上下文：`content="…"` 的捕获里必须**容纳整个载荷**
 *     （若载荷的引号没被转义，捕获会在那里被截断，剩下的就落到属性外面了）
 *
 * 以及一条决定性的全局判据：**按 HTML 分词规则扫一遍，看有没有多出来的标签/属性**。
 * 这一点不能用正则数标签 —— 那会把属性值里的 `<script>` 也算成真标签（我第一版就是这么错的）。
 * 所以下面写了一个遵守引号状态的极小分词器。
 *
 * ## 判定器自带牙齿（本套件第 1 组）
 *
 * 一个写错的判定器会让所有断言永远绿。所以第 1 组先拿**已知安全**与**已知危险**的
 * HTML 样本给判定器做自检：危险样本必须被抓出来（并指出是哪个标签/属性），
 * 安全样本必须放行。判定器坏了，第 1 组立刻报红。
 *
 * ## 还有一条防「空洞断言」的控制
 *
 * 如果种入的值压根没进 head（比如页面级 `useHead` 覆盖了 TDK —— 实测 `/tokens` 就是如此），
 * 那么「没有破出」是全绿但**毫无意义**的。所以每组都断言「载荷确实到达了 head」，
 * 且全局要求到达次数 ≥ 5。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// 独占端口 3272（3210-3277 里未被其他套件占用）
const APP_PORT = 3272
const BASE = `http://127.0.0.1:${APP_PORT}`

/** 恶意载荷：既能闭合元素文本，又带引号以测试属性上下文 */
const P = '"><script>alert(1)</script>'
const MARK = 'alert(1)'
const DEAL_ID = 'probe_head_deal'
const COLL_ID = 'probe_head_coll'

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

// ══════════════════════════════════════════════════════════════════
// 判定器
// ══════════════════════════════════════════════════════════════════

/**
 * 遵守引号状态的极小 HTML 分词器：只认「真正的标签」与「真正的属性名」。
 * 属性值里的 `<script>`、`onload=` 一律不算 —— 这正是它与正则数的区别。
 */
function tokenizeTags(html) {
  const tags = []
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) break
    if (!/[a-zA-Z!/]/.test(html[lt + 1] || '')) { i = lt + 1; continue }
    if (html[lt + 1] === '!' || html[lt + 1] === '/') {
      const gt = html.indexOf('>', lt)
      const name = /^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, gt + 1))
      const end = gt < 0 ? html.length : gt + 1
      tags.push({ name: (name?.[1] || '!').toLowerCase(), attrs: [], closing: html[lt + 1] === '/', start: lt, end })
      i = end
      continue
    }
    // 开始标签：读名字，再读属性（尊重 " 与 ' 的引号状态）
    let j = lt + 1
    const nm = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(j))
    if (!nm) { i = lt + 1; continue }
    const name = nm[1].toLowerCase()
    j += nm[1].length
    const attrs = []
    while (j < html.length) {
      while (j < html.length && /\s/.test(html[j])) j++
      if (html[j] === '>' || html[j] === undefined) break
      if (html[j] === '/') { j++; continue }
      const am = /^([^\s=/>]+)/.exec(html.slice(j))
      if (!am) { j++; continue }
      const aname = am[1].toLowerCase()
      j += am[1].length
      while (j < html.length && /\s/.test(html[j])) j++
      let quote = 'none'
      let hasValue = false
      if (html[j] === '=') {
        hasValue = true
        j++
        while (j < html.length && /\s/.test(html[j])) j++
        const q = html[j]
        if (q === '"' || q === "'") {
          quote = q
          const close = html.indexOf(q, j + 1)
          j = close < 0 ? html.length : close + 1
        } else {
          while (j < html.length && !/[\s>]/.test(html[j])) j++
        }
      }
      attrs.push({ name: aname, quote, hasValue })
    }
    const gt = html.indexOf('>', j)
    const end = gt < 0 ? html.length : gt + 1
    tags.push({ name, attrs, closing: false, start: lt, end })
    i = end
  }
  return tags
}

/**
 * 去掉「真标签」与 `<title>` 内文之后剩下的文本。
 *
 * 这是最强的那条判据：转义正确时，载荷**只**会出现在
 *   (a) 带引号的属性值内 —— 已被分词器当作标签的一部分吃掉
 *   (b) `<title>` 的内文里 —— 显式挖掉
 * 所以剩下的文本里不该再有载荷标记。一旦 unhead 停止转义，
 * 属性会被载荷的引号提前结束，后面的 `<script>alert(1)</script>`
 * 就变成真标签、`alert(1)` 落在标签之间的文本里 → 立刻被抓到。
 *
 * 这一条是必要的：光看「有没有意外标签/属性」抓不到注入的**裸 `<script>`**，
 * 因为 head 里本来就有合法的 `<script type="application/json">`（Nuxt 水合数据）。
 */
function textOutsideTags(html) {
  const blanked = html.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
  const tags = tokenizeTags(blanked)
  let out = ''
  let cursor = 0
  for (const t of tags) {
    if (t.start > cursor) out += blanked.slice(cursor, t.start)
    cursor = Math.max(cursor, t.end)
  }
  out += blanked.slice(cursor)
  return out
}

/** head 里允许出现的元素 */
const ALLOWED_TAGS = new Set(['title', 'meta', 'link', 'style', 'script', 'noscript', 'base', 'template', '!', 'html', 'head', 'body'])
/** 允许出现在 head 标签上的属性名 */
const ALLOWED_ATTRS = new Set([
  'name', 'property', 'content', 'charset', 'http-equiv', 'rel', 'href', 'type', 'as', 'crossorigin',
  'media', 'sizes', 'hreflang', 'integrity', 'nonce', 'src', 'async', 'defer', 'id', 'class', 'data-v-inspector',
])

/**
 * 扫描 head，返回「不该出现的标签」与「不该出现的属性」。
 * 只有遵守引号状态的分词结果才会进来 —— 属性值里的载荷不会被误判。
 */
function scanBreakout(head) {
  const badTags = []
  const badAttrs = []
  // 引号风格统计：只关心带值的属性。unhead 的 encodeAttribute 只转义双引号，
  // 所以值必须始终用双引号包裹 —— 换风格这个转义就不够了。
  const oddQuote = []
  for (const t of tokenizeTags(head)) {
    if (!ALLOWED_TAGS.has(t.name)) badTags.push(t.name)
    for (const a of t.attrs) {
      if (!ALLOWED_ATTRS.has(a.name)) badAttrs.push(`${t.name}[${a.name}]`)
      // 只对**有值**的属性判引号风格：`<link crossorigin>` 这种布尔属性本来就没有值
      if (a.hasValue && a.quote !== '"') oddQuote.push(`${t.name}[${a.name}] quote=${a.quote}`)
    }
  }
  // 决定性判据：标签之外的文本里不许出现载荷标记。
  // 注意 head 里本来就有合法的内联 <script>（Nuxt 主题脚本 / 水合 JSON），它们的内文会
  // 落进「标签之外」——所以只认载荷自己的特征（MARK 与 <script），
  // **不用** `/on\w+=/` 这种宽泛模式：合法脚本里也可能出现，会变成误报。
  const residue = textOutsideTags(head)
  let leaked = false
  let where = ''
  for (const needle of [MARK, '<script']) {
    const at = residue.indexOf(needle)
    if (at >= 0) {
      leaked = true
      // 诊断要指向**命中处**，而不是残留文本的开头（那里往往是无关的合法脚本）
      where = residue.slice(Math.max(0, at - 70), at + needle.length + 40).replace(/\s+/g, ' ')
      break
    }
  }
  return { badTags, badAttrs, leaked, where, oddQuote }
}

/** 把 HTML 实体解回原字符（用于断言「解码后就是原载荷」） */
function decodeEntities(s) {
  return String(s)
    .replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0*34;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
}
const titleInner = (head) => (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1] ?? null
/** 属性捕获：捕获里必须容纳整个载荷，否则说明载荷的引号提前结束了属性 */
const attrValue = (head, re) => (re.exec(head) || [])[1] ?? null

async function grab(path) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual', signal: ac.signal })
    const html = await res.text()
    return { status: res.status, html, head: (/<head[\s\S]*?<\/head>/i.exec(html) || [''])[0] }
  } catch (e) {
    return { status: 0, html: '', head: '', err: e?.name }
  } finally { clearTimeout(timer) }
}

try {
  mkdirSync(join(ROOT, 'data'), { recursive: true })
  dbPath = join(ROOT, 'data', `head-injection-${Date.now()}.db`)

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第1组：判定器自检（判定器坏了，后面全是假绿）')
  // ══════════════════════════════════════════════════════════════
  {
    // 安全样本：载荷被困在属性值内（引号已转义）—— 判定器必须放行
    const safe1 = `<head><title>&quot;&gt;&lt;script&gt;${MARK}&lt;/script&gt;</title>`
      + `<meta name="description" content="x&quot;><script>${MARK}</script>"></head>`
    const r1 = scanBreakout(safe1)
    check('自检·安全样本（载荷困在属性值内/已转义）→ 判定器放行', r1.badTags.length === 0 && r1.badAttrs.length === 0,
      `误报: ${JSON.stringify(r1)}`)
    check('自检·安全样本里的裸 <script> 不被当成真标签（引号状态生效）',
      tokenizeTags(safe1).filter(t => t.name === 'script').length === 0,
      `真标签: ${JSON.stringify(tokenizeTags(safe1).map(t => t.name))}`)

    // 危险样本 1：title 被提前闭合 → 注入 svg onload
    const bad1 = `<head><title>t</title><svg onload="${MARK}"></svg></head>`
    const r2 = scanBreakout(bad1)
    check('自检·危险样本1（注入 <svg onload>）→ 判定器抓出标签与属性',
      r2.badTags.includes('svg') && r2.badAttrs.some(a => a.includes('onload')), JSON.stringify(r2))

    // 危险样本 2：属性被闭合 → 注入事件处理器
    const bad2 = `<head><meta name="description" content="x" onerror="${MARK}"></head>`
    const r3 = scanBreakout(bad2)
    check('自检·危险样本2（注入 onerror 属性）→ 判定器抓出属性',
      r3.badAttrs.some(a => a.includes('onerror')), JSON.stringify(r3))

    // 危险样本 3：属性被闭合 → 注入 <img onerror>
    const bad3 = `<head><meta name="keywords" content=""><img src=x onerror="${MARK}"></head>`
    const r4 = scanBreakout(bad3)
    check('自检·危险样本3（注入 <img onerror>）→ 判定器抓出标签与属性',
      r4.badTags.includes('img') && r4.badAttrs.some(a => a.includes('onerror')), JSON.stringify(r4))

    // 危险样本 4：**不转义**时属性被闭合 → 注入裸 <script>（标签白名单抓不到，只能靠残留文本判据）
    const bad4 = `<head><meta name="description" content="prov"><script>${MARK}</script> 的免费额度通告"></head>`
    const r5 = scanBreakout(bad4)
    check('自检·危险样本4（注入裸 <script>，标签白名单抓不到）→ 残留文本判据抓到',
      r5.leaked === true, JSON.stringify({ leaked: r5.leaked, where: r5.where }))
    check('自检·危险样本4 的残留文本里确实有载荷标记', r5.where.includes(MARK), r5.where)

    // 安全样本必须**不**被残留判据误报
    const r6 = scanBreakout(safe1)
    check('自检·安全样本不被残留文本判据误报', r6.leaked === false,
      JSON.stringify({ leaked: r6.leaked, where: r6.where }))
  }

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
    env: { ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), NUXT_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', () => {})
  appProcess.stderr.on('data', (d) => {
    const s = String(d).trim()
    if (s && !s.includes('statusMessage')) console.error(`  [app] ${s.slice(0, 180)}`)
  })
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

  // ── 种入恶意内容 ──
  {
    const Database = req()('better-sqlite3')
    const db = new Database(dbPath)
    try {
      const uid = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id ?? 1
      const now = Date.now()
      db.prepare(`INSERT OR REPLACE INTO token_deals
        (id,user_id,provider,title,url,category,state,status,created_at,summary,quality,source_tag)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(DEAL_ID, uid, `prov${P}`, `标题${P}`, 'https://head.example.com/', 'token',
             'published', 'published', now, `摘要${P}`, '中品', 'official')
      db.prepare(`INSERT OR REPLACE INTO collections
        (id,user_id,name,description,is_public,is_official,meta_title,meta_description,meta_keywords,
         created_at,updated_at,bookmark_count)
        VALUES (?,?,?,?,1,0,?,?,?,?,?,0)`)
        .run(COLL_ID, uid, `合集${P}`, `描述${P}`, `元标题${P}`, `元描述${P}`, `元关键词${P}`, now, now)
      const put = db.prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)')
      put.run('siteTitle', `站点${P}`)
      put.run('siteDescription', `站点描述${P}`)
      put.run('siteKeywords', `站点关键词${P}`)
    } finally { db.close() }
  }

  let arrivedCount = 0
  /** 一次完整的落点判定：上下文 + 破出扫描 + 是否真到达 */
  const judgePage = async (label, path) => {
    const r = await grab(path)
    console.log(`\n  ── ${label}  (${path}) status=${r.status} head=${r.head.length}B`)
    check(`${label} 页面可访问 → 200`, r.status === 200, `status=${r.status}`)

    // 元素文本上下文
    const inner = titleInner(r.head)
    if (inner === null) {
      check(`${label} <title> 存在`, false)
    } else {
      const decoded = decodeEntities(inner)
      const reached = decoded.includes(P)
      if (reached) arrivedCount++
      check(`${label} <title> 里没有裸 <（元素文本上下文未被破出）`, !inner.includes('<'),
        inner.slice(0, 120))
      check(`${label} <title> 的载荷解码后等于原值（证明是转义而非丢弃）`, reached,
        `解码后=${JSON.stringify(decoded.slice(0, 110))}`)
    }

    // 属性上下文：捕获里必须容纳整个载荷
    const desc = attrValue(r.head, /<meta[^>]*name="description"[^>]*content="([^"]*)"/i)
    if (desc !== null) {
      const reached = decodeEntities(desc).includes(P) || decodeEntities(desc).includes(P)
      if (reached) arrivedCount++
      check(`${label} meta[description] 的捕获容纳了整个载荷（引号已转义）`,
        decodeEntities(desc).includes(P) || desc.includes('&quot;'), `捕获=${JSON.stringify(desc.slice(0, 110))}`)
    }

    // 决定性判据：遵守引号状态的分词后，没有多出来的标签/属性，且标签外无载荷残留
    const scan = scanBreakout(r.head)
    check(`${label} head 里没有意外标签`, scan.badTags.length === 0, JSON.stringify(scan.badTags))
    check(`${label} head 里没有意外属性（含 on* 事件处理器）`, scan.badAttrs.length === 0,
      JSON.stringify(scan.badAttrs))
    check(`${label} 标签之外的文本里没有载荷残留（未破出成页面内容）`, scan.leaked === false,
      `命中处=${JSON.stringify(scan.where)}`)
    // 潜在前提：unhead 的 encodeAttribute **只转义双引号**（对双引号属性上下文来说充分且最小）。
    // 一旦值改用单引号或省引号包裹，那个转义就不够了 —— 这条把前提钉住。
    // 判定必须走分词器：用正则会误伤 `content="width=device-width, initial-scale=1"`
    // 里的 `initial-scale=1`（我自己在这里犯过一次同样的错）。
    check(`${label} head 里的属性值都用双引号包裹（encodeAttribute 只转义双引号，换风格即失效）`,
      scan.oddQuote.length === 0, `异常引号: ${JSON.stringify(scan.oddQuote.slice(0, 4))}`)
    return r
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第2组：用户可控 —— 通告标题/摘要进详情页 head')
  // ══════════════════════════════════════════════════════════════
  const dealPage = await judgePage('通告详情页', `/tokens/${DEAL_ID}.html`)
  // 断言「这一页确实渲染了这个通告」——摘要**不会**进 head（description 用的是 provider + 固定文案），
  // 所以只能拿标题与服务商做锚点。这也是防「空页全绿」的控制。
  check('通告详情页的 head 确实含该通告的标题与服务商（不是空页）',
    dealPage.head.includes('标题') && dealPage.head.includes('prov'),
    `标题=${dealPage.head.includes('标题')} prov=${dealPage.head.includes('prov')}`)

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第3组：用户可控 —— 精选集名称/meta_* 进 head')
  // ══════════════════════════════════════════════════════════════
  await judgePage('精选集页', `/collections/${COLL_ID}`)

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第4组：管理员可控 —— TDK 进首页 head')
  // ══════════════════════════════════════════════════════════════
  await judgePage('首页', '/')

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第5组：防「空洞断言」—— 载荷必须真的到达了 head')
  // ══════════════════════════════════════════════════════════════
  {
    console.log(`     实测载荷到达 head 的落点数：${arrivedCount}`)
    check('载荷到达 head 的落点数 ≥ 5（否则前面的「无破出」是空洞的）', arrivedCount >= 5,
      `实际 ${arrivedCount} —— 若为 0，说明种入的数据没进 head，本套件什么都没验证`)
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n▶ 第6组：对照组 —— 宿主的真实 HTML 整体不含未转义注入')
  // ══════════════════════════════════════════════════════════════
  {
    for (const [label, path] of [['通告详情页', `/tokens/${DEAL_ID}.html`], ['精选集页', `/collections/${COLL_ID}`], ['首页', '/']]) {
      const r = await grab(path)
      const scan = scanBreakout(r.head)
      check(`${label} 整页 head 分词结果干净且无载荷残留`,
        scan.badTags.length === 0 && scan.badAttrs.length === 0 && scan.leaked === false, JSON.stringify(scan))
      // 载荷标记不应出现在 body 之外的「可执行」位置
      check(`${label} head 里不存在真正的 <script>alert 标签`,
        tokenizeTags(r.head).filter(t => t.name === 'script').every(t => true) &&
        !/<\/title>\s*<script[^>]*>\s*alert\(1\)/i.test(r.head),
        r.head.slice(0, 120))
    }
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
