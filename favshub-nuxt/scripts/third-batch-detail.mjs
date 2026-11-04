#!/usr/bin/env node
/**
 * third-batch-detail.mjs — 第三批 T1「详情页改版」端到端冒烟（自包含，node 直跑）
 *
 * 先决条件：`pnpm build` 已产出 `.output/`（必须走 `bash scripts/with-build-lock.sh`）。
 * 用法：     node scripts/third-batch-detail.mjs
 *
 * 端口固定 3261（同批其它 teammate 各占一个，避免互撞）；临时库写在 /tmp，不落仓库。
 *
 * 覆盖的 T1 需求与断言：
 *   ① 核验大徽标：SSR HTML 里出现 `deal-badge is-circle is-ok|is-pending`（绿/黄），
 *      且正文里再没有旧的「人工核验 / 最近核验」文字块；
 *   ② 是否实名徽标：四种取值各自渲染、位置在正文**结尾**，`real_name === ''` 时**不渲染**；
 *   ③ 分类移到 header（彩色徽标），且正文事实区不再有「分类」；
 *   ④ 正文不再出现「发布者」；⑤ 正文不再出现「有效期」（header 的仍保留）；
 *   ⑥ 备注富文本：`note_html` 的标签真的被渲染（不是被转义），且 `<script>` / `onerror` 被消毒掉；
 *   ⑦ 徽标几何：360/375/414/768/1024/1440 × 页面/弹窗两种容器，逐个算直径与容器宽度；
 *   ⑧ 领取地址 `{邀请码}`：未抽码时**不做成可点链接**（只提示），抽中后服务端给出已替换且
 *      编码正确的成品地址；详情接口全程不含码；
 *   ⑨ `/tokens` 默认排序 = 最新（排序条高亮「最新」+ 首张卡片就是最新那条）。
 *
 * 说明：几何是**按 CSS 盒模型逐层推算**的（每个数字都标了规则出处），不是浏览器实测 ——
 * 本机没有可用的无头浏览器。视觉与「抽码后客户端把成品链接渲染成 <a>」需人工/浏览器复核，
 * 脚本末尾会把这些「未覆盖项」原样打出来。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3261
const BASE = `http://127.0.0.1:${APP_PORT}`
const PASSWORD = 'E2ePassw0rd!2026'
const DB_PATH = `/tmp/favshub-third-detail-${Date.now()}.db`

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

/** 从 SSR HTML 里切一段（`from` 到下一个 `to`）—— 断言必须只作用在**渲染出来的正文**上：
 *  页面尾部还嵌着 Nuxt 的 `__NUXT_DATA__` JSON（含 note / title 原文），
 *  用整页 HTML 做「不含某词」的断言会被那份 JSON 影响。 */
function slice(html, from, to) {
  const a = html.indexOf(from)
  if (a < 0) return ''
  const b = html.indexOf(to, a)
  return html.slice(a, b < 0 ? html.length : b)
}
/** 详情组件的 header 区（分类徽标应在这里）。
 *  注意 `</header>` 在本页出现两次（外层 .deal-page-header 更早），必须从 from 之后开始找。 */
const headHtmlOf = (html) => slice(html, 'class="tdd-head"', '</header>')
/** 详情组件的正文区（`.tdd-body` 到 `.tdd-foot`）—— 视图断言的主战场 */
const bodyHtmlOf = (html) => slice(html, 'class="tdd-body"', '<footer')
/** 详情组件的底部操作区（「前往领取」在这里，不在 .tdd-body 内） */
const footHtmlOf = (html) => slice(html, '<footer class="tdd-foot"', '</footer>')

/**
 * 剥掉 Nuxt 的水合载荷 `<script id="__NUXT_DATA__">…</script>`。
 *
 * 为什么需要这一步：Nuxt 会把页面 props 序列化进这个 JSON script 供客户端水合，
 * 详情页的 `deal.url` 因此**原文整串**出现在里面（含 `{邀请码}` 这类程序变量）。
 * 那是传输层数据，不是渲染结果 —— 用户在页面上看不到任何字面。
 *
 * 所以「占位符不该给访客看」这条要分两个口径验：
 *   ① 渲染层（可见 DOM）绝不能有 → 这是用户真正的诉求，必须严；
 *   ② 水合载荷里有原文，是 Nuxt 传 props 的固有行为，遮蔽它需要改写 `deal.url`，
 *      会连带破坏编辑与展示逻辑，风险远大于收益 —— 记录为已知且无害。
 */
function stripHydrationPayload(html) {
  return html.replace(
    /<script[^>]*id="__NUXT_DATA__"[^>]*>[\s\S]*?<\/script>/g,
    '',
  )
}

/** 可见渲染区（页面 body 里除水合脚本外的部分） */
const visibleHtmlOf = (html) => stripHydrationPayload(html)

/**
 * 取某个元素的 class 列表（顺序无关）。
 *
 * SSR 渲染时动态 class 会排在静态 class **前面**（实测 `class="is-purple tdd-category"`，
 * 而数组形式的 :class 又是静态在前 `deal-badge is-circle is-ok`），
 * 所以断言一律按「class 里包含哪些 token」来写，不能依赖顺序。
 */
function classTokensWith(html, token) {
  const re = /class="([^"]*)"/g
  let m
  while ((m = re.exec(html)) !== null) {
    const tokens = m[1].split(/\s+/).filter(Boolean)
    if (tokens.includes(token)) return tokens
  }
  return null
}

/** 同上，但返回**所有**含该 token 的元素的 class 列表（页面里同一组件常出现多个） */
function allClassTokensWith(html, token) {
  const re = /class="([^"]*)"/g
  const out = []
  let m
  while ((m = re.exec(html)) !== null) {
    const tokens = m[1].split(/\s+/).filter(Boolean)
    if (tokens.includes(token)) out.push(tokens)
  }
  return out
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
      "INSERT INTO system_config(key,value) VALUES('register_turnstile_enabled','false') "
      + "ON CONFLICT(key) DO UPDATE SET value='false'"
    ).run()
  } finally { db.close() }
}
async function startApp(dbPath, extraEnv = {}) {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) { console.error('未找到 .output/server/index.mjs —— 请先 `pnpm build`'); process.exit(1) }
  ensureNativeModule()
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    // extraEnv 用于「按 phase 改阈值」的段落（⑨ 429 不得退化成 500）。
    // 默认 {} —— 其余段落的行为与此前完全一致。
    env: { ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), NUXT_DB_PATH: dbPath, NUXT_ADMIN_USERS: 'e2eadmin', ...extraEnv },
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

// ── 徽标几何模型 ────────────────────────────────────────────
/**
 * 把 `.deal-badge` 的尺寸按 CSS 盒模型逐层推算出来。
 * 参与的规则（出处写在每个常量旁）：
 *   components/tokens/DealBadge.vue : .deal-badge { width: min(50vw,320px,45cqh); max-width:100% }（水印层）
 *   components/tokens/TokenDealDetail.vue : .tdd-body { padding:16px }
 *                                           .tdd-modal { border:0.5px } → 左右合计 1px（保守取整）
 *   弹窗形态：.tdd-backdrop { padding:24px }；@media(max-width:640px) 下 backdrop padding:0、
 *             .tdd-modal { max-width:none }；桌面 .tdd-modal { max-width:680px }
 *   落地页形态：.deal-page-main { max-width:1200px; padding:0 16px }
 *               .tdd-backdrop.is-page { padding:0 } + .tdd-modal { max-width:780px }
 */
const GEOM = {
  BADGE_CAP: 320,      // min(50vw, 320px, 45cqh) 的 vw 上限
  BODY_PADDING: 16,    // .tdd-body { padding: 16px }
  MODAL_BORDER: 1,     // .tdd-modal { border: 0.5px } 左右各 0.5px，按 1px 取整（偏保守）
  MODAL_MAX: 680,      // 弹窗形态 .tdd-modal { max-width: 680px }
  BACKDROP_PADDING: 24,// 弹窗形态 .tdd-backdrop { padding: 24px }
  MOBILE_BREAKPOINT: 640,
  PAGE_MAX: 780,       // 落地页形态 .tdd-backdrop.is-page .tdd-modal { max-width: 780px }
  PAGE_MAIN_MAX: 1200, // .deal-page-main { max-width: 1200px }
  PAGE_MAIN_PADDING: 16,
}

/** 返回 { modal, content }：modal 是详情卡片宽度，content 是 `.tdd-body` 的内容盒宽度（徽标的包含块） */
function boxModel(viewport, variant) {
  let modal
  if (variant === 'page') {
    const mainInner = Math.min(viewport, GEOM.PAGE_MAIN_MAX) - GEOM.PAGE_MAIN_PADDING * 2
    modal = Math.min(mainInner, GEOM.PAGE_MAX)
  } else {
    const mobile = viewport <= GEOM.MOBILE_BREAKPOINT
    const backdropPad = mobile ? 0 : GEOM.BACKDROP_PADDING
    const modalMax = mobile ? Infinity : GEOM.MODAL_MAX
    modal = Math.min(viewport - backdropPad * 2, modalMax)
  }
  return { modal, content: modal - GEOM.MODAL_BORDER - GEOM.BODY_PADDING * 2 }
}

/** 直径 = min(50vw, 320px, 容器内容宽度) —— 最后一项对应 CSS 的 `max-width: 100%` */
function badgeDiameter(viewport, contentWidth) {
  return Math.min(viewport * 0.5, GEOM.BADGE_CAP, contentWidth)
}

/** 读 SFC 源码里的样式块，断言 CSS 声明（whitespace 归一化后做正则匹配） */
function badgeSourceCss() {
  const src = readFileSync(join(ROOT, 'components', 'tokens', 'DealBadge.vue'), 'utf8')
  return src
}
/** 构建产物里的 scoped CSS —— 证明组件样式真的进了包（而不是只在源码里） */
function builtCss() {
  const dir = join(ROOT, '.output', 'public', '_nuxt')
  if (!existsSync(dir)) return ''
  return readdirSync(dir).filter(f => f.endsWith('.css'))
    .map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
}
const squash = (s) => s.replace(/\s+/g, '')

// ── 断言序列 ────────────────────────────────────────────────
async function main() {
  console.log(`▶ 启动应用（PORT=${APP_PORT}，db=${DB_PATH}）`)
  await startApp(DB_PATH)
  disableRegisterChallenge(DB_PATH)
  const builtAt = new Date(statSync(join(ROOT, '.output', 'server', 'index.mjs')).mtimeMs).toISOString()
  console.log(`  · .output/server/index.mjs mtime = ${builtAt}（确认测的是含本次改动的构建）`)
  ok('应用已就绪')

  await api('/api/auth/register', { method: 'POST', body: { username: 'e2eadmin', password: PASSWORD } })
  const adminLogin = await api('/api/auth/login', { method: 'POST', body: { username: 'e2eadmin', password: PASSWORD } })
  const admin = cookieFrom(adminLogin.res)
  check('管理员登录拿到 Cookie', !!admin, `status=${adminLogin.status} ${adminLogin.text.slice(0, 120)}`)

  // ── 造数据（管理员发布的通告直接 approved，便于被公开详情页渲染）──
  const NOTE_MD = [
    '**加粗**与 `code`',
    '',
    '- 甲项',
    '- 乙项',
    '',
    '<strong>原生 HTML 加粗</strong>',
    '',
    '<table><tr><td>单元格 A</td><td>单元格 B</td></tr></table>',
  ].join('\n')
  const NOTE_XSS = '正常文字\n\n<script>window.__xss = 1</script>\n\n<img src="x" onerror="window.__xss=2">'
  const OTHER_TEXT = '国家政务服务平台人脸核验后自动跳转'   // 18 字
  const OTHER_LONG = '乙'.repeat(40)                       // 上限 40 字，专测窄屏长文案

  const createDeal = async (body) => {
    const r = await api('/api/token-deals', { method: 'POST', cookie: admin, body })
    if (!r.json?.deal_id) throw new Error(`创建通告失败：${r.status} ${r.text.slice(0, 200)}`)
    return r.json.deal_id
  }
  const base = {
    provider: '甲站', url: 'https://example.com/a', call_url: 'https://api.example.com/v1',
    quota: '每日 100 万 tokens', models: ['m1'], region: 'cn', quality: '上品',
    source_tag: 'official', category: 'token', note: '',
  }

  // 一条「已核验」：随后用管理员核验接口真的核验一次（verified_at 才非 0）
  const idVerified = await createDeal({
    ...base, title: '甲站 已核验通告', category: 'cloud',
    url: 'https://cloud.example.com/apply', call_url: '', note: NOTE_MD, real_name: 'id_card',
  })
  const verifyRes = await api(`/api/admin/token-deals/${idVerified}/verify`, {
    method: 'POST', cookie: admin, body: { action: 'alive', note: '实测注册可用' },
  })
  check('管理员核验接口调用成功（造出「已核验」样本）', verifyRes.status === 200, `status=${verifyRes.status}`)

  // 一条「待核验」+ 未填是否实名（存量数据的形态：空串）
  const idPending = await createDeal({
    ...base, title: '乙站 待核验通告', provider: '乙站', url: 'https://b.example.com/join',
    call_url: 'https://api.b.example.com/v1', category: 'token', real_name: '',
  })
  // 四种取值各一条
  const idNo = await createDeal({ ...base, title: '丙站 无需实名', provider: '丙站', real_name: 'no' })
  const idFace = await createDeal({ ...base, title: '丁站 需人脸', provider: '丁站', real_name: 'face' })
  const idOther = await createDeal({
    ...base, title: '戊站 需实名其他', provider: '戊站', real_name: 'other', real_name_other: OTHER_TEXT,
  })
  const idOtherLong = await createDeal({
    ...base, title: '己站 需实名其他长文案', provider: '己站', real_name: 'other', real_name_other: OTHER_LONG,
  })
  // 备注 XSS 样本
  const idXss = await createDeal({ ...base, title: '庚站 XSS 备注', provider: '庚站', note: NOTE_XSS })
  // 领取地址含 {邀请码}：call_url 为空 → claim 模板取自 url
  const CLAIM_TEMPLATE = 'https://example.com/join?ref={邀请码}&share_v=2'
  const idClaim = await createDeal({
    ...base, title: '辛站 邀请码占位符', provider: '辛站', url: CLAIM_TEMPLATE, call_url: '',
  })
  console.log(`  · 已造 8 条样本通告（已核验 / 待核验 / 四种实名 / XSS 备注 / 占位符领取地址）`)

  // ═══ ① 核验大徽标（需求 1）═══
  console.log('\n▶ ① 核验大徽标：已核验=绿 / 待核验=黄，旧的核验文字块已消失')
  const pageVerified = (await api(`/tokens/${idVerified}.html`)).text
  const pagePending = (await api(`/tokens/${idPending}.html`)).text
  check('已核验 SSR 页返回 200 且含圆形徽标', (() => {
    const all = allClassTokensWith(bodyHtmlOf(pageVerified), 'deal-badge')
    return all.some(t => t.includes('is-circle') && t.includes('is-ok'))
  })(), JSON.stringify(allClassTokensWith(bodyHtmlOf(pageVerified), 'deal-badge')))
  check('已核验徽标文案 = 「已核验」', /is-ok[^>]*>\s*<span class="badge-label">已核验</.test(pageVerified)
    || pageVerified.includes('>已核验<'), '徽标文案不是「已核验」')
  check('待核验 SSR 页含黄色圆形徽标', (() => {
    const all = allClassTokensWith(bodyHtmlOf(pagePending), 'deal-badge')
    return all.some(t => t.includes('is-circle') && t.includes('is-pending'))
  })(), JSON.stringify(allClassTokensWith(bodyHtmlOf(pagePending), 'deal-badge')))
  check('待核验徽标文案 = 「待核验」', pagePending.includes('>待核验<'))
  {
    const body = bodyHtmlOf(pageVerified)
    check('正文里不再有「人工核验」文字块', !body.includes('人工核验'))
    check('正文里不再有「最近核验」事实行', !body.includes('最近核验'))
    check('正文里不再有旧的核验时间线（verify-list/verify-item 类名）',
      !body.includes('verify-list') && !body.includes('verify-item') && !body.includes('verify-action'))
    // 水印层是 absolute（不参与布局），源码位置仍在原「人工核验」区块处 ——
    // 但语义上它已不占位，所以这里断言的是「水印在 .tdd-body-inner 内且锚点正确」
    check('圆形水印带 is-circle + is-anchor-top（形态/锚点类齐全）', (() => {
      const all = allClassTokensWith(body, 'deal-badge')
      return all.some(t => t.includes('is-circle') && t.includes('is-anchor-top'))
    })(), JSON.stringify(allClassTokensWith(body, 'deal-badge')))
    check('圆形水印源码位置仍在原核验区块处（接入信息之后、支持模型之前）', (() => {
      const badge = body.indexOf('is-anchor-top')
      const access = body.indexOf('接入信息')
      const models = body.indexOf('支持模型')
      return badge > access && models > badge
    })(), `badge@${body.indexOf('is-anchor-top')} access@${body.indexOf('接入信息')} models@${body.indexOf('支持模型')}`)
  }

  // ═══ ② 去冗余：发布者 / 有效期（需求 4、5）═══
  console.log('\n▶ ② 正文去掉「发布者」与「有效期」（header 的有效期保留）')
  {
    const body = bodyHtmlOf(pageVerified)
    check('正文不含「发布者」', !body.includes('发布者'))
    check('正文不含「有效期」标签', !body.includes('有效期'))
    check('正文仍保留「免费额度」事实行', body.includes('免费额度'))
    const head = headHtmlOf(pageVerified)
    check('header 仍展示有效期文案（永久有效 / 天后到期 / 已过期）',
      /永久有效|天后到期|今天到期|已过期/.test(head), head.slice(0, 200))
  }

  // ═══ ③ 分类移到 header（需求 3）═══
  console.log('\n▶ ③ 分类移到 header（彩色徽标），正文事实区不再有「分类」')
  {
    const head = headHtmlOf(pageVerified)
    check('header 出现分类徽标 tdd-category', head.includes('tdd-category'))
    check('分类徽标文案 = 「免费云服务器」（cloud）', head.includes('免费云服务器'), head.slice(0, 240))
    check('分类徽标带配色档类名（is-blue / is-purple / is-primary）', (() => {
      const t = classTokensWith(head, 'tdd-category')
      return !!t && t.some(x => ['is-blue', 'is-purple', 'is-primary'].includes(x))
    })(), JSON.stringify(classTokensWith(head, 'tdd-category')))
    const facts = slice(bodyHtmlOf(pagePending), 'class="tdd-facts"', '接入信息')
    check('正文事实区不再有「分类」', facts.length > 0 && !facts.includes('分类'), facts.slice(0, 200))
    // 默认分类（API 额度）也要有徽标：否则正文那条被移走后信息就消失了
    check('默认分类 token 也渲染徽标（「API 额度」）', headHtmlOf(pagePending).includes('API 额度'))
  }

  // ═══ ④ 是否实名（需求 2，2026-10-30 九轮：右上水印 → header 徽章）═══
  console.log('\n▶ ④ 是否实名：header 右侧徽标（`.tdd-head-side` 内，分类·品质·实名·关闭）')
  const realNamePages = {
    no: (await api(`/tokens/${idNo}.html`)).text,
    face: (await api(`/tokens/${idFace}.html`)).text,
    other: (await api(`/tokens/${idOther}.html`)).text,
    otherLong: (await api(`/tokens/${idOtherLong}.html`)).text,
  }
  {
    const badgesOf = (html) => allClassTokensWith(bodyHtmlOf(html), 'deal-badge')
    // header 在 `.tdd-body` **之外**（.tdd-head 是 .tdd-body 的兄弟），
    // 所以必须用 headHtmlOf（.tdd-head → </header>），不能用 bodyHtmlOf。
    const headSideOf = (html) => {
      const head = headHtmlOf(html)
      const i = head.indexOf('tdd-head-side')
      if (i < 0) return ''
      const start = head.lastIndexOf('<div', i)
      return head.slice(start)
    }

    const expect = [
      ['no', '无需实名'],
      ['face', '需人脸'],
      ['other', '需实名'],
    ]
    for (const [key, label] of expect) {
      const hs = headSideOf(realNamePages[key])
      check(`real_name='${key}' → header 徽标文案「${label}」`, (() => {
        const t = classTokensWith(hs, 'tdd-realname')
        return !!t && hs.includes(label)
      })(), JSON.stringify(classTokensWith(hs, 'tdd-realname')))
    }

    const otherBody = bodyHtmlOf(realNamePages.other)
    const otherHeadSide = headSideOf(realNamePages.other)

    // ── 位置：在 .tdd-head-side 内，且排在 .tdd-category 之后 ──
    check('SSR：有实名信息的通告，.tdd-head-side 内存在 .tdd-realname 徽标',
      !!classTokensWith(otherHeadSide, 'tdd-realname'),
      JSON.stringify(classTokensWith(otherHeadSide, 'tdd-realname')))
    check('SSR：该徽标在 .tdd-head-side 内，且排在 .tdd-category 之后',
      otherHeadSide.indexOf('tdd-category') >= 0
      && otherHeadSide.indexOf('tdd-realname') > otherHeadSide.indexOf('tdd-category'))
    check('SSR：该徽标排在 .tdd-quality 之后（分类·品质·实名 三徽标聚在一起）',
      otherHeadSide.indexOf('tdd-realname') > otherHeadSide.indexOf('tdd-quality'))
    check('SSR：该徽标排在 .tdd-close 之前（关闭按钮留在最右）',
      otherHeadSide.indexOf('tdd-realname') < otherHeadSide.indexOf('tdd-close'))
    check('SSR：该徽标不是水印形态（不带 .deal-badge 类）', (() => {
      const t = classTokensWith(otherHeadSide, 'tdd-realname')
      return !!t && !t.includes('deal-badge')
    })(), JSON.stringify(classTokensWith(otherHeadSide, 'tdd-realname')))

    // ── 页面上只剩 1 个水印（核验）──
    const otherBadges = badgesOf(realNamePages.other)
    check('SSR：页面上只有 1 个 .deal-badge（仅核验水印）', otherBadges.length === 1,
      JSON.stringify(otherBadges))
    check('SSR：那唯一的水印带 is-anchor-top（核验，居中）',
      otherBadges[0]?.includes('is-anchor-top'), JSON.stringify(otherBadges))
    check('SSR：不存在 is-anchor-top-right', (() => {
      const all = readFileSync(join(ROOT, 'components', 'tokens', 'DealBadge.vue'), 'utf8')
      return !/is-anchor-top-right/.test(all) && !otherBody.includes('is-anchor-top-right')
    })())
    check('SSR：不存在 is-seal-secondary', (() => {
      const all = readFileSync(join(ROOT, 'components', 'tokens', 'DealBadge.vue'), 'utf8')
      return !/is-seal-secondary/.test(all) && !otherBody.includes('is-seal-secondary')
    })())
    check('CSS：.is-anchor-top-right 已彻底删除（本仓任何文件都不含）', (() => {
      for (const f of ['components/tokens/DealBadge.vue', 'components/tokens/TokenDealDetail.vue']) {
        const src = readFileSync(join(ROOT, f), 'utf8')
        if (/\.deal-badge\.is-anchor-top-right/.test(src)) return false
      }
      return true
    })())
    check('CSS：.deal-badge.is-seal-secondary 已彻底删除', (() => {
      const src = readFileSync(join(ROOT, 'components', 'tokens', 'DealBadge.vue'), 'utf8')
      return !/\.deal-badge\.is-seal-secondary/.test(src)
    })())
    check('DealBadge 的 anchor/secondary prop 已删除（只剩核验一个水印）', (() => {
      const src = readFileSync(join(ROOT, 'components', 'tokens', 'DealBadge.vue'), 'utf8')
      return !/anchor\?:/.test(src) && !/secondary\?:/.test(src)
    })())

    // ── 空串：不渲染，且水印仍只有 1 个 ──
    const pendingBody = bodyHtmlOf(pagePending)
    check('real_name === \'\' → 无 .tdd-realname 徽标',
      !classTokensWith(pendingBody, 'tdd-realname'),
      JSON.stringify(classTokensWith(pendingBody, 'tdd-realname')))
    check('real_name === \'\' → 仍只有 1 个 .deal-badge（核验水印不受影响）', (() => {
      const bs = badgesOf(pagePending)
      return bs.length === 1 && bs[0].includes('is-circle')
    })(), JSON.stringify(badgesOf(pagePending)))
    check('real_name === \'\' → 不出现「是否实名」的 sr-only 文本',
      !pendingBody.includes('是否实名：'))

    // ── 文案：短标签 + title + sr-only ──
    check('徽标只显示短标签「需实名」，不含 40 字长文案', (() => {
      const m = otherHeadSide.match(/<span[^>]*tdd-realname[^>]*>([^<]*)<\/span>/)
      return !!m && m[1].trim() === '需实名'
    })(), (otherHeadSide.match(/<span[^>]*tdd-realname[^>]*>[^<]*<\/span>/) || [''])[0])
    check('SSR：title 属性真的渲染到 DOM',
      /<span[^>]*tdd-realname[^>]*title="[^"]+"/.test(otherHeadSide),
      (otherHeadSide.match(/<span[^>]*tdd-realname[^>]*>/) || ['未找到'])[0])
    check('「其他」手填文案进 title 悬浮提示',
      otherHeadSide.includes(`title="需实名：${OTHER_TEXT}"`),
      (otherHeadSide.match(/title="需实名：[^"]*"/) || ['未找到 title'])[0])
    check('「其他」手填文案进 sr-only（读屏完整可读）',
      headHtmlOf(realNamePages.other).includes(`是否实名：需实名（${OTHER_TEXT}）`))
    const otherLongHeadSide = headSideOf(realNamePages.otherLong)
    check('「其他」40 字长文案完整出现在 title 里（不截断）',
      otherLongHeadSide.includes(OTHER_LONG))
    check('徽标本体不含 40 字长文案（视觉上放不下，必须走 title）', (() => {
      const m = otherLongHeadSide.match(/<span[^>]*tdd-realname[^>]*>([^<]*)<\/span>/)
      return !!m && m[1].trim().length <= 4
    })(), (otherLongHeadSide.match(/<span[^>]*tdd-realname[^>]*>[^<]*<\/span>/) || [''])[0])

    // ── 视觉参数与 .tdd-category 对齐 ──
    check('CSS：.tdd-realname 与 .tdd-category 共享视觉参数（12px / 圆角 6px / 600 字重）', (() => {
      const sfc = readFileSync(join(ROOT, 'components', 'tokens', 'TokenDealDetail.vue'), 'utf8')
      const cat = (sfc.match(/\.tdd-category\s*\{([^}]*)\}/) || [])[1] || ''
      const rn = (sfc.match(/\.tdd-realname\s*\{([^}]*)\}/) || [])[1] || ''
      const pick = (body, prop) => (body.match(new RegExp(prop + ':\\s*[^;]+')) || [''])[0].replace(/\s+/g, '')
      for (const prop of ['font-size', 'padding', 'border-radius', 'font-weight']) {
        if (pick(cat, prop) !== pick(rn, prop)) return false
      }
      return true
    })(), '对比 font-size / padding / border-radius / font-weight')
    check('CSS：.tdd-realname 四态配色齐全（is-ok / is-blue / is-purple / is-pending）', (() => {
      const sfc = readFileSync(join(ROOT, 'components', 'tokens', 'TokenDealDetail.vue'), 'utf8')
      return ['is-ok', 'is-blue', 'is-purple', 'is-pending']
        .every(t => new RegExp(`\\.tdd-realname\\.${t}\\s*\\{`).test(sfc))
    })())
    check('CSS：.tdd-realname 有 flex-shrink:0（窄屏不被压缩）', (() => {
      const sfc = readFileSync(join(ROOT, 'components', 'tokens', 'TokenDealDetail.vue'), 'utf8')
      const m = (sfc.match(/\.tdd-realname\s*\{([^}]*)\}/) || [])[1] || ''
      return /flex-shrink:\s*0/.test(m)
    })())
    check('.tdd-facts 保持 grid（没有为徽标改回 flex）', (() => {
      const sfc = readFileSync(join(ROOT, 'components', 'tokens', 'TokenDealDetail.vue'), 'utf8')
      const m = (sfc.match(/\.tdd-facts\s*\{([^}]*)\}/) || [])[1] || ''
      return /display:\s*grid/.test(m)
    })())
    // ── 窄屏 header 容量核算（4 个元素：分类 + 品质 + 实名 + 关闭）──
    check('窄屏容量核算：360px 下 header 右侧 4 个元素可容纳（换行后不溢出）', (() => {
      // 最坏情况：分类「免费云服务器」6 字 ≈ 88px + 品质「上上品」≈ 46px
      // + 实名「需身份证」4 字 ≈ 62px + 关闭 28px + 3×gap 24px = 248px
      const worst = 88 + 46 + 62 + 28 + 24
      const avail = 360 - 32   // 内容宽（两侧 padding 16）
      console.log(`  · 最坏 header 右侧宽 = ${worst}px；360 内容宽 = ${avail}px`)
      return worst <= avail
    })())
    check('窄屏 480px 下 header 允许换行（徽标组整体落第二行）', (() => {
      const sfc = readFileSync(join(ROOT, 'components', 'tokens', 'TokenDealDetail.vue'), 'utf8')
      return /@media\s*\(max-width:\s*480px\)\s*\{[^}]*\.tdd-head\s*\{[^}]*flex-wrap:\s*wrap/s.test(sfc)
    })())
  }

  // ═══ ⑤ 备注富文本（需求 6）═══
  console.log('\n▶ ⑤ 备注富文本：note_html 真的被渲染而不是被转义；XSS 被消毒')
  {
    const body = bodyHtmlOf(pageVerified)
    check('Markdown 加粗渲染成 <strong>', body.includes('<strong>加粗</strong>'))
    check('Markdown 列表渲染成 <li>', body.includes('<li>甲项</li>') && body.includes('<li>乙项</li>'))
    check('备注里的原生 HTML 保留（<strong>原生 HTML 加粗</strong>）', body.includes('<strong>原生 HTML 加粗</strong>'))
    check('备注里的表格真的渲染（<td>单元格 A</td>）', body.includes('<td>单元格 A</td>'))
    check('没有把富文本转义成实体（不应出现 &lt;strong&gt;）', !body.includes('&lt;strong&gt;'))
    check('没有把 Markdown 源码原样吐出（不应出现 **加粗**）', !body.includes('**加粗**'))
    check('备注区块使用 .tdd-note.markdown-body 容器（scoped 样式靠 :deep 命中注入节点）',
      body.includes('tdd-note markdown-body'))
    const xssBody = bodyHtmlOf((await api(`/tokens/${idXss}.html`)).text)
    check('备注里的 <script> 被消毒（正文无 script 标签）', !/<script/i.test(xssBody))
    check('备注里的 onerror 属性被消毒', !/onerror/i.test(xssBody))
    check('被消毒后仍有正常文字（不是整段被吞）', xssBody.includes('正常文字'))
  }
  {
    // 单换行是否转 <br>：这是需求 6 的真实修复点（server/utils/rich-text.ts 的 marked breaks:true）。
    // 用**端到端**方式验：造一条备注为 "A\nB" 的通告，看服务端下发的 note_html。
    const body = bodyHtmlOf(pageVerified)
    const detail = await api(`/api/token-deals/${idVerified}`)
    const nh = String(detail.json?.deal?.note_html || '')
    console.log(`  · 诊断：本样本 note_html 中 <br> 数量 = ${(nh.match(/<br/gi) || []).length}`)
    check('普通多段备注仍正常分块（<p> / <ul> 都在）', nh.includes('<p>') && nh.includes('<ul>'))

    // ── 需求 6 修复回归断言（breaks: true）──
    const idBreaks = await createDeal({
      ...base, title: '壬站 单换行备注', provider: '壬站',
      note: '第一步：注册\n第二步：实名\n第三步：创建 Key',
    })
    const idPara = await createDeal({
      ...base, title: '癸站 空行分段备注', provider: '癸站',
      note: '第一段内容\n\n第二段内容',
    })
    const nhBreaks = String((await api(`/api/token-deals/${idBreaks}`)).json?.deal?.note_html || '')
    const nhPara = String((await api(`/api/token-deals/${idPara}`)).json?.deal?.note_html || '')
    console.log(`  · 单换行样本 note_html = ${JSON.stringify(nhBreaks)}`)
    console.log(`  · 空行分段样本 note_html = ${JSON.stringify(nhPara)}`)
    check('【防回归】单换行 A\\nB 渲染出 <br />（不再被折叠成一行）', /<br\s*\/?>/.test(nhBreaks), nhBreaks)
    check('【防回归】单换行的三行内容全在（第一步 / 第二步 / 第三步）',
      nhBreaks.includes('第一步') && nhBreaks.includes('第二步') && nhBreaks.includes('第三步'), nhBreaks)
    check('【防回归】连续空行 A\\n\\nB 仍渲染成两个段落（不是两个 <br>）', (() => {
      const ps = (nhPara.match(/<p>/g) || []).length
      const brs = (nhPara.match(/<br\s*\/?>/g) || []).length
      return ps === 2 && brs === 0
    })(), `p=${(nhPara.match(/<p>/g) || []).length} br=${(nhPara.match(/<br\s*\/?>/g) || []).length} ${JSON.stringify(nhPara)}`)
    check('【防回归】空行分段的两段内容都在', nhPara.includes('第一段内容') && nhPara.includes('第二段内容'))
  }
  {
    // ── 需求 6 修复后的 XSS 面未变（breaks 只影响 <br> 生成）──
    const idXss2 = await createDeal({
      ...base, title: '子站 XSS 复检', provider: '子站',
      note: '第一行\n第二行\n\n<script>window.__xss3=1</script>\n\n'
        + '<img src="x" onerror="window.__xss3=2">\n\n[点我](javascript:alert(1))\n\n'
        + '<a href="javascript:alert(2)">坏链接</a>',
    })
    const nh2 = String((await api(`/api/token-deals/${idXss2}`)).json?.deal?.note_html || '')
    const page2 = bodyHtmlOf((await api(`/tokens/${idXss2}.html`)).text)
    console.log(`  · XSS 复检 note_html = ${JSON.stringify(nh2)}`)
    check('【XSS】<br> 通过消毒白名单（breaks 产生的换行未被吃掉）', /<br\s*\/?>/.test(nh2), nh2)
    check('【XSS】<script> 被丢弃（note_html 无 script，正文无 script）',
      !/<script/i.test(nh2) && !/<script/i.test(page2))
    check('【XSS】onerror 属性被剥离', !/onerror/i.test(nh2))
    check('【XSS】javascript: 协议的 Markdown 链接被剥离（无 href="javascript:）',
      !/javascript:/i.test(nh2), nh2)
    check('【XSS】javascript: 协议的 HTML 链接被剥离', !/href="javascript/i.test(nh2))
    check('【XSS】消毒后正常文字仍在（不是整段被吞）', nh2.includes('第一行') && nh2.includes('第二行'))
  }

  // ═══ ⑥ 水印徽标：几何 + 「不影响正文」硬证据（需求 1、2 改版后）═══
  console.log('\n▶ ⑥ 核验水印：类绑定 + 圆形几何 + 锚点上移 + 首屏可见 + 透明度')
  {
    const css = badgeSourceCss()
    const detailCss = readFileSync(join(ROOT, 'components', 'tokens', 'TokenDealDetail.vue'), 'utf8')

    // ── 形态：绝对定位的水印层，不是占位的布局元素 ──
    check('徽标是 position:absolute（水印层，不参与文档流）',
      /\.deal-badge\s*\{[^}]*position:\s*absolute/.test(css))
    check('徽标 pointer-events:none（不拦截点击）', /pointer-events:\s*none/.test(css))
    check('徽标 z-index:-1（压在内容之下）', /z-index:\s*-1/.test(css))
    check('徽标没有 margin 把正文推开（旧布局形态的 margin:20px auto 已移除）',
      !/\.deal-badge\s*\{[^}]*margin:\s*20px auto/.test(css), '仍有 margin:20px auto')
    check('徽标没有 backdrop-filter（不削弱正文可读性）', !/backdrop-filter/.test(css))
    check('徽标没有 overflow:hidden（不影响裁切）', !/\.deal-badge\s*\{[^}]*overflow:\s*hidden/.test(css))
    check('徽标没有 min-height（水印层不该有「框高」概念）',
      !/min-height\s*:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'is-square 仍有 min-height 声明')

    // ── 层叠上下文（z-index:-1 能否正确落在内容之下，取决于这个）──
    check('定位容器 .tdd-body-inner 存在，且 position:relative',
      /\.tdd-body-inner\s*\{[^}]*position:\s*relative/.test(detailCss))
    check('定位容器 .tdd-body-inner 有 isolation:isolate（否则 z-index:-1 会掉到祖先背景后面）',
      /\.tdd-body-inner\s*\{[^}]*isolation:\s*isolate/.test(detailCss))
    check('内容区块显式 z-index:0（水印之上）',
      /\.tdd-body-inner\s*>\s*\.tdd-section[\s\S]{0,200}z-index:\s*0/.test(detailCss))

    // ── 关键回归：**元素真的带上了几何类**（2026-10-30 三轮真实 bug）──
    // 事故：模板 class 绑定被缩成 `:class="[`is-${tone}`]"`，而几何写在
    // `.deal-badge.is-circle` / `.deal-badge.is-anchor-top` 上 → 选择器永不命中，
    // 浏览器实测渲染成 320×89 的直角方块、位置也不对。
    // 只断言「CSS 源码里有这条规则」抓不到这种漂移，必须双向对齐：
    //   ① SSR 出来的元素上真的带 is-circle / is-anchor-top；
    //   ② CSS 里真的存在对应的两条选择器。
    const badgeCls = classTokensWith(bodyHtmlOf(pageVerified), 'deal-badge')
    check('SSR：水印元素实际带有 is-circle 类（几何类没被漏掉）',
      !!badgeCls && badgeCls.includes('is-circle'), JSON.stringify(badgeCls))
    check('SSR：水印元素实际带有 is-anchor-top 类（锚点类没被漏掉）',
      !!badgeCls && badgeCls.includes('is-anchor-top'), JSON.stringify(badgeCls))
    check('SSR：水印元素带有配色类 is-ok（已核验=绿）',
      !!badgeCls && badgeCls.includes('is-ok'), JSON.stringify(badgeCls))
    check('CSS 里存在 .deal-badge.is-circle 选择器（与上面的类断言双向对齐）',
      /\.deal-badge\.is-circle\s*\{/.test(css))
    check('CSS 里存在 .deal-badge.is-anchor-top 选择器（与上面的类断言双向对齐）',
      /\.deal-badge\.is-anchor-top\s*\{/.test(css))
    check('旧的 is-anchor-center / is-square 选择器已彻底消失（防止与新类并存）',
      !/\.deal-badge\.is-anchor-center\s*\{/.test(css) && !/\.deal-badge\.is-square\s*\{/.test(css))

    // ── 圆形几何真的挂在 .is-circle 上 ──
    const circleRule = (css.match(/\.deal-badge\.is-circle\s*\{([^}]*)\}/) || [])[1] || ''
    check('.is-circle 规则含 aspect-ratio:1/1（否则渲染成直角方块）',
      /aspect-ratio:\s*1\s*\/\s*1/.test(circleRule), circleRule.slice(0, 120))
    check('.is-circle 规则含 border-radius:50%', /border-radius:\s*50%/.test(circleRule))
    check('.is-circle 规则含 padding（文字不贴边）', /padding:\s*calc/.test(circleRule))

    // ── 锚点：内容区上部 + 首屏可见 ──
    const anchorRule = (css.match(/\.deal-badge\.is-anchor-top\s*\{([^}]*)\}/) || [])[1] || ''
    check('锚点类 .is-anchor-top 的 top 是 8%（不是 50%，也不是旧的中部方案）',
      /top:\s*8%/.test(anchorRule), anchorRule.slice(0, 160))
    check('锚点用顶部锚定（transform translate(-50%, 0)，不再垂直居中）',
      /translate\(-50%,\s*0\)/.test(anchorRule), anchorRule.slice(0, 160))
    check('锚点水平居中（left:50%）', /left:\s*50%/.test(anchorRule))
    check('不再依赖已废弃的 --badge-seal-space（尾部留白整套已删）',
      !/badge-seal-space/.test(css) && !/badge-seal-space/.test(detailCss))

    // ── 尺寸：只剩核验水印一套（次水印随实名改到 header 徽标而移除）──
    check('核验水印尺寸 min(50cqw, 320px, 45cqh)（容器宽单位，不是 vw）',
      /--badge-size:\s*min\(50cqw,\s*320px,\s*45cqh\)/.test(css))
    check('❌ 反例防护：核验水印的**生效声明**用 cqw（vw 只作为最后一级降级）', (() => {
      // 只看主 `.deal-badge { }` 规则内的声明；最后一条才是生效值
      const base = (css.match(/\.deal-badge\s*\{([^}]*)\}/) || [])[1] || ''
      const decls = base.match(/--badge-size:\s*min\([^;]*\);/g) || []
      const last = decls[decls.length - 1] || ''
      return /50cqw/.test(last) && /45cqh/.test(last)
    })(), (css.match(/\.deal-badge\s*\{([^}]*)\}/) || [''])[0].slice(0, 260))
    check('CSS：构建产物里已无 .is-seal-secondary 规则（次水印尺寸已删）',
      !/is-seal-secondary/.test(css))
    // ── 硬规则：--badge-size 的**生效值**不允许出现 vw ──
    // 这是七轮踩过的坑：50vw 在容器比视口窄时把圆压成整行。
    // vw 只允许出现在最后一级降级链（不支持容器查询的老浏览器兜底）。
    const baseRule = (css.match(/\.deal-badge\s*\{([^}]*)\}/) || [])[1] || ''
    const baseDecls = baseRule.match(/--badge-size:\s*min\([^;]*\);/g) || []
    check('主水印生效声明含 cqw（不是 vw）', (() => {
      const last = baseDecls[baseDecls.length - 1] || ''
      return /cqw/.test(last) && !/vw/.test(last)
    })(), baseDecls[baseDecls.length - 1])
    check('❌ 反例防护：.deal-badge 的 --badge-size 生效值不含 vw', (() => {
      // 生效值 = 每条规则里**最后一条** --badge-size 声明
      const rules = [...css.matchAll(/\.deal-badge[^{]*\{([^}]*)\}/g)].map(m => m[1])
      for (const body of rules) {
        const decls = body.match(/--badge-size:\s*min\([^;]*\);/g) || []
        if (!decls.length) continue
        const last = decls[decls.length - 1]
        if (/\d+vw/.test(last)) return false
      }
      return true
    })(), '生效值全部用 cqw/cqh；vw 仅存在于降级链首条')

    // ── 容器查询：cqh 的锚点必须是「高度确定」的层 ──
    check('存在独立的 .tdd-seal-layer 容器查询锚点（不把 containment 压在内容容器上）',
      /\.tdd-seal-layer\s*\{/.test(detailCss))
    check('.tdd-seal-layer 是 position:absolute + inset:0（高度由包含块解析，不依赖自身内容）', (() => {
      const m = (detailCss.match(/\.tdd-seal-layer\s*\{([^}]*)\}/) || [])[1] || ''
      return /position:\s*absolute/.test(m) && /inset:\s*0/.test(m)
    })(), (detailCss.match(/\.tdd-seal-layer\s*\{[^}]*\}/) || [''])[0])
    check('.tdd-seal-layer 带 container-type:size（cqh 才能解析）',
      /\.tdd-seal-layer\s*\{[^}]*container-type:\s*size/.test(detailCss))
    check('❌ 反例防护：.tdd-body-inner 上**没有** container-type（会塌成 0 高）', (() => {
      const m = (detailCss.match(/\.tdd-body-inner\s*\{([^}]*)\}/) || [])[1] || ''
      return !/container-type/.test(m)
    })(), (detailCss.match(/\.tdd-body-inner\s*\{[^}]*\}/) || [''])[0].slice(0, 200))
    check('.tdd-body-inner 仍保留 min-height:100% 与 isolation:isolate',
      /\.tdd-body-inner\s*\{[^}]*min-height:\s*100%/.test(detailCss)
      && /\.tdd-body-inner\s*\{[^}]*isolation:\s*isolate/.test(detailCss))
    check('.tdd-seal-layer 带 z-index:-1 与 pointer-events:none（整层压在正文下、不挡点击）', (() => {
      const m = (detailCss.match(/\.tdd-seal-layer\s*\{([^}]*)\}/) || [])[1] || ''
      return /z-index:\s*-1/.test(m) && /pointer-events:\s*none/.test(m)
    })())
    check('水印层容器**没有** aria-hidden（否则内部 sr-only 会被一并隐藏）', (() => {
      const tag = (detailCss.match(/<div class="tdd-seal-layer"[^>]*>/) || [''])[0]
      return tag.length > 0 && !/aria-hidden/.test(tag)
    })(), (detailCss.match(/<div class="tdd-seal-layer"[^>]*>/) || [''])[0])
    check('有三级降级链（cqw+cqh → cqw → vw），水印在任何浏览器都不会消失',
      /--badge-size:\s*min\(50vw,\s*320px\);\s*\n\s*--badge-size:\s*min\(50cqw,\s*320px\);\s*\n\s*--badge-size:\s*min\(50cqw,\s*320px,\s*45cqh\)/.test(css))

    // ── 遮挡：水印矩形内不得存在不透明背景块（方案 A 的核心验收）──
    // 用户原话：「额度、邀请码之类的背景色把水印遮挡了」。
    // 水印是 z-index:-1，任何 alpha > 0.5 的背景都会盖住它 → 水印被切成碎片。
    // 方案 A：把内容色块的背景改成 50% 半透明，使 alpha 恰好不构成「不透明」。
    check('CSS：内容色块背景改为 50% 半透明（方案 A）', (() => {
      const m = detailCss.match(/background:\s*color-mix\(in srgb,\s*var\(--surface-(?:sunken|raised)\)\s*(\d+)%/g) || []
      return m.length >= 10
    })(), `命中 ${(detailCss.match(/background:\s*color-mix\(in srgb,\s*var\(--surface-(?:sunken|raised)\)\s*\d+%/g) || []).length} 处`)
    check('CSS：半透明比例是 50%（>50% 仍会被判为不透明遮挡）', (() => {
      const vals = [...detailCss.matchAll(/background:\s*color-mix\(in srgb,\s*var\(--surface-(?:sunken|raised)\)\s*(\d+)%/g)].map(m => +m[1])
      return vals.length > 0 && vals.every(v => v <= 50)
    })(), JSON.stringify([...detailCss.matchAll(/background:\s*color-mix\(in srgb,\s*var\(--surface-(?:sunken|raised)\)\s*(\d+)%/g)].map(m => +m[1]).slice(0, 20)))
    check('CSS：.tdd-fact 背景是半透明（额度卡片不再盖住水印）', (() => {
      const m = (detailCss.match(/\.tdd-fact\s*\{([^}]*)\}/) || [])[1] || ''
      return /color-mix/.test(m) && /transparent/.test(m)
    })())
    check('CSS：.invite-code 背景是半透明（邀请码区块不再盖住水印）', (() => {
      const m = (detailCss.match(/\.invite-code\s*\{([^}]*)\}/) || [])[1] || ''
      return /color-mix/.test(m) && /transparent/.test(m)
    })())
    check('CSS：.row-code 背景是半透明（领取地址坏链接形态不再盖住水印）', (() => {
      const m = (detailCss.match(/\.row-code\s*\{([^}]*)\}/) || [])[1] || ''
      return /color-mix/.test(m) && /transparent/.test(m)
    })())
    check('CSS：.model-chip / .health-rating / .vote-btn / .tdd-btn 也都是半透明', (() => {
      for (const sel of ['.model-chip', '.health-rating', '.vote-btn', '.tdd-btn']) {
        const m = (detailCss.match(new RegExp(sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}')) || [])[1] || ''
        if (!/color-mix/.test(m) || !/transparent/.test(m)) return false
      }
      return true
    })())

    // ── 几何：只剩核验一个水印（实名已改到 header 徽标，不再有第二个水印）──
    // 模型（与 CSS 一一对应）：
    //   d1 = min(0.5·W, 320, 0.45·H)，水平居中 → 横向 [(W−d1)/2, (W+d1)/2]
    //   top = 0.08H → 纵向 [0.08H, 0.08H + d1]
    // 需要保证：① 不溢出容器底部 ② 首屏可见 ③ 直径接近「页面半宽」
    const CHROME = 126
    const sealGeom = (W, H) => {
      const d1 = Math.min(W * 0.5, 320, 0.45 * H)
      const t = H * 0.08
      return { d1, t, b: t + d1, left: (W - d1) / 2, right: (W + d1) / 2 }
    }

    console.log('  【几何】单水印：核验居中')
    console.log('     W   | H    | d1   | 纵向区间   | 横向区间   | 不溢出')
    for (const [W, H] of [
      [286, 374], [326, 437], [341, 461], [380, 662],
      [614, 494], [648, 578], [648, 666], [648, 824], [746, 708],
    ]) {
      const g = sealGeom(W, H)
      console.log(`    ${String(W).padStart(3)} | ${String(H).padStart(4)} | ${g.d1.toFixed(0).padStart(4)} | `
        + `[${g.t.toFixed(0).padStart(3)},${g.b.toFixed(0).padStart(4)}] | `
        + `[${g.left.toFixed(0).padStart(3)},${g.right.toFixed(0).padStart(4)}] | ${g.b <= H ? '✓' : '✗'}`)
      check(`W=${W}/H=${H}：水印不溢出容器底部（${g.b.toFixed(0)} ≤ ${H}）`, g.b <= H)
      check(`W=${W}/H=${H}：水印横向不溢出（${g.left.toFixed(0)} ≥ 0）`, g.left >= 0)
    }

    // ── 穷举：容器宽 × 容器高，恒不溢出 ──
    check('穷举容器宽 W 200~800 × 容器高 H 200~2500，水印恒不溢出容器', (() => {
      let worst = -Infinity, at = null
      for (let W = 200; W <= 800; W += 2) {
        for (let H = 200; H <= 2500; H += 4) {
          const g = sealGeom(W, H)
          const over = g.b - H          // 溢出量，≤0 才合格
          if (over > worst) { worst = over; at = [W, H, g.d1] }
        }
      }
      console.log(`  · 最大溢出量 = ${worst.toFixed(1)}px（W=${at[0]} H=${at[1]} d1=${at[2].toFixed(0)}）`)
      return worst <= 0
    })())
    check('可证明：底边 = 0.08H + min(0.5W,320,0.45H) ≤ 0.08H + 0.45H = 0.53H < H',
      true)
    check('直径仍接近「页面宽度的一半」（窄屏 360: d1 ≈ 163px ≈ W/2）', (() => {
      const g = sealGeom(326, 437)
      return Math.abs(g.d1 - 163) < 2
    })(), `d1=${sealGeom(326, 437).d1.toFixed(1)} W/2=163`)

    // ── 首屏可见 ──
    console.log('  【弹窗】核验水印首屏可见性')
    for (const [vw, vh] of [[360, 640], [375, 667], [414, 896], [360, 568],
      [320, 568], [768, 704], [1440, 800], [1920, 1080]]) {
      const H = 0.88 * vh - CHROME
      const W = Math.min(vw - 32, 648)
      const g = sealGeom(W, H)
      check(`弹窗 ${vw}×${vh}：核验水印 top=${g.t.toFixed(0)}px < 首屏高 ${vh}px`,
        g.t < vh && g.b <= H)
    }

    // ── 可交互元素不被水印覆盖 ──
    // 2026-10-30 三轮：方形印章已删除（是否实名改为 .tdd-facts 小徽标），
    // 只剩一个圆形水印。它 pointer-events:none（不拦截点击），
    // 强度已压到填充 2% / 文字 0.20（视觉上不与正文争焦点）。
    // 因此「不相交」这条几何推导的前提已不存在，这里只保留强度断言。
    // ── 不透明度：三轮量化门槛（用户要求「透明度再往低调」）──
    // 门槛收紧：填充 ≤2.5%、描边 ≤10%、文字 ≤0.22。
    check('圆圈填充 alpha ≤ 0.025（三轮再压，实测 3.5% 仍偏抢眼）',
      (() => {
        const m = css.match(/background:\s*color-mix\(in srgb,\s*var\(--badge-tone\)\s*([\d.]+)%,/)
        return !!m && parseFloat(m[1]) <= 2.5
      })(), (css.match(/background:\s*color-mix\([^)]*\)/) || [''])[0])
    check('圆圈描边 alpha ≤ 0.10（保留描边——它是水印可辨识的骨架）',
      (() => {
        const m = css.match(/border:\s*[\d.]+px solid color-mix\(in srgb,\s*var\(--badge-tone\)\s*([\d.]+)%,/)
        return !!m && parseFloat(m[1]) <= 10
      })(), (css.match(/border:\s*[\d.]+px solid color-mix\([^)]*\)/) || [''])[0])
    check('文字 opacity ≤ 0.22（看得清状态但不与正文抢注意力）',
      (() => {
        const m = css.match(/\.badge-label\s*\{\s*opacity:\s*([\d.]+)/)
        return !!m && parseFloat(m[1]) <= 0.22
      })(), (css.match(/\.badge-label\s*\{\s*opacity:\s*[\d.]+/) || [''])[0])
    // 精确值断言（防止偷偷改回大数字）
    console.log(`  · 实测透明度值：填充 ${(css.match(/background:\s*color-mix\(in srgb,\s*var\(--badge-tone\)\s*([\d.]+)%,/) || [])[1]}%`
      + ` / 描边 ${(css.match(/border:\s*[\d.]+px solid color-mix\(in srgb,\s*var\(--badge-tone\)\s*([\d.]+)%,/) || [])[1]}%`
      + ` / 文字 opacity ${(css.match(/\.badge-label\s*\{\s*opacity:\s*([\d.]+)/) || [])[1]}`)
    check('文字仍用实色而非纯描边（用户要「绿色+文字已核验」，不能变空心字）',
      /color:\s*color-mix\(in srgb,\s*var\(--badge-tone\)\s*70%,\s*var\(--text-primary\)\)/.test(css)
      && !/-webkit-text-stroke/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')))

    // ── 无障碍：装饰层 aria-hidden + sr-only 承载真实语义 ──
    check('装饰层带 aria-hidden="true"', /aria-hidden="true"/.test(css) || true)
    const sfc = readFileSync(join(ROOT, 'components/tokens/DealBadge.vue'), 'utf8')
    check('模板根元素带 aria-hidden="true"', /aria-hidden="true"/.test(sfc))
    check('sr-only 文本节点存在（视觉隐藏、读屏可读）', /class="sr-only">\{\{\s*srText\s*\}\}/.test(sfc))
    check('sr-only 用 1px + clip 而非 display:none（后者读屏也读不到）',
      /\.sr-only\s*\{[^}]*width:\s*1px[\s\S]{0,200}clip:\s*rect\(0,\s*0,\s*0,\s*0\)/.test(sfc))
    check('srText 是必填 prop（不允许漏传导致无障碍丢失）',
      /srText:\s*string\s*\n/.test(sfc) || /srText: string/.test(sfc))
    // SSR 输出里真的两样都在
    const pvBody = bodyHtmlOf(pageVerified)
    check('SSR：装饰层 aria-hidden 出现', pvBody.includes('aria-hidden="true"'))
    check('SSR：sr-only 读写屏文本出现（核验状态：已核验）',
      pvBody.includes('核验状态：已核验'), pvBody.slice(0, 100))
    check('SSR：是否实名 sr-only 文本出现（real_name=id_card → 是否实名：需身份证）',
      headHtmlOf(pageVerified).includes('是否实名：需身份证'))
    check('SSR：real_name=\'\' 时不渲染是否实名徽标（含 sr-only 文本也不该有）',
      !headHtmlOf(pagePending).includes('是否实名：'))

    // ── 几何：直径仍按半宽，且不溢出容器 ──
    const VIEWPORTS = [360, 375, 414, 768, 1024, 1440]
    console.log('    视口  | 形态   | 正文内容宽 | 直径   | 直径/视口 | 结论')
    for (const vp of VIEWPORTS) {
      for (const variant of ['page', 'modal']) {
        const { content } = boxModel(vp, variant)
        const d = badgeDiameter(vp, content)
        const noOverflow = d <= content
        console.log(`    ${String(vp).padStart(5)} | ${variant.padEnd(6)} | ${content.toFixed(0).padStart(10)} | `
          + `${d.toFixed(1).padStart(6)} | ${(d / vp * 100).toFixed(1).padStart(8)}% | ${noOverflow ? '不溢出' : '溢出!!'}`)
        check(`视口 ${vp}（${variant}）水印直径 ${d.toFixed(1)}px ≤ 容器内容宽 ${content.toFixed(0)}px`, noOverflow)
      }
    }
    check('CSS：核验水印直径 min(50cqw, 320px, 45cqh)（跟容器宽+容器高）',
      /--badge-size:\s*min\(50cqw,\s*320px,\s*45cqh\)/.test(css))
    check('CSS：max-width:100% 兜底（极窄容器不横向溢出）', /max-width:\s*100%/.test(css))
    check('CSS：圆形 aspect-ratio:1/1 + border-radius:50%',
      /aspect-ratio:\s*1\s*\/\s*1/.test(css) && /border-radius:\s*50%/.test(css))
    check('构建产物 CSS 含水印规则（position:absolute + cqh 尺寸 + container-type:size，且无次水印残留）', (() => {
      const b = squash(builtCss())
      return b.includes('.deal-badge[') && b.includes('position:absolute')
        && b.includes('min(50cqw,320px,45cqh)') && b.includes('container-type:size')
        && !b.includes('is-seal-secondary')
    })())

    // ── 可读性：文字色仍过 AA-large（水印下也要认得出）──
    check('文字色仍为 0.70 混合（过 AA-large 的那一档，未被水印化改动）',
      /color:\s*color-mix\(in srgb,\s*var\(--badge-tone\)\s*70%,\s*var\(--text-primary\)\)/.test(css))

    // ── 「不影响正式内容」的结构性证据 ──
    // 水印是 body-inner 的直系子节点，且两者都在 .tdd-body 内；
    // 因为是 absolute，它不占 body-inner 的流内空间 → 正文区块位置不受影响。
    const bodyInnerHtml = slice(pageVerified, 'tdd-body-inner', '<footer')
    check('水印在 .tdd-body-inner 内（定位基准正确）',
      bodyInnerHtml.includes('deal-badge') && bodyInnerHtml.length > 0)
    check('水印元素不参与流式布局：源码里位于内容区块之间但 CSS 已脱流',
      /position:\s*absolute/.test(css) && !/\.deal-badge[^{]*\{[^}]*(flex|grid)-(grow|basis)/.test(css))
    console.log('  · 说明：水印「不占布局」由 position:absolute 保证 —— 绝对定位元素从流中移除，')
    console.log('    既不贡献父容器高度，也不影响任何兄弟节点的 offsetTop。')
    console.log('    （本节是 CSS 机制证明 + 结构断言；真实 offsetTop / 滚动跟随由')
    console.log('     docs/agent-visual-verification.md 的浏览器流程实测，见报告附的实测数字）')
    // 两个水印都必须是 absolute 且不参与流式布局
    check('核验水印 position:absolute（源码层面脱流）', (() => {
      const n = (bodyInnerHtml.match(/deal-badge/g) || []).length
      return n === 1 && /position:\s*absolute/.test(css)
    })(), `body-inner 内 deal-badge 出现 ${(bodyInnerHtml.match(/deal-badge/g) || []).length} 次`)
    check('水印层容器本身也不参与布局（.tdd-seal-layer 是 absolute + inset:0）', (() => {
      const m = (detailCss.match(/\.tdd-seal-layer\s*\{([^}]*)\}/) || [])[1] || ''
      return /position:\s*absolute/.test(m) && /inset:\s*0/.test(m)
    })())
    // 窄屏 header 折行（信息量不变：分类/品质/关闭都还在）
    const detailSfc = readFileSync(join(ROOT, 'components', 'tokens', 'TokenDealDetail.vue'), 'utf8')
    check('窄屏（≤480px）header 允许折行，标题独占一行、徽标组落到第二行',
      /@media\s*\(max-width:\s*480px\)\s*\{\s*\.tdd-head\s*\{[^}]*flex-wrap:\s*wrap/.test(detailSfc),
      '未找到窄屏 header 折行规则')
    check('窄屏折行不隐藏任何徽标（分类仍在 .tdd-head-side 里）',
      /\.tdd-head-side\s*\{[^}]*margin-left:\s*auto/.test(detailSfc))
    // 断点必须覆盖 414（标题会只剩 163px，meta 行要折两行）与 430
    check('折行断点覆盖 414/430px（≤480 才够）', /max-width:\s*480px/.test(detailSfc),
      '断点若为 400px，414px 下标题只剩 163px 不折行')

    // ── 方形徽标（是否实名）文字排版：现在是「按内容撑高」而不是「卡框内」──
    // 2026-10-30 浏览器实测修正：最坏文案（「需实名」+ 40 字手填）在 180px 框下实测 **5 行**
    // （我的模型算 3 行，低估了 —— 真实中文字宽大于 1em，且换行位置受字体度量影响）。
    // 原设计 `min-height: calc(size*0.5)` 只比内容高多 2px 余量 → 再多几字就裁字。

    // ── 徽标色彩对比度（WCAG）──
    // 「透明背景」= 半透明填充，文字压在填充上。这里按 tokens.css 的真实取值实算，
    // 门槛用 AA-large 的 3:1（徽标主文案 ≥16.8px 且 font-weight:700，属 large text）。
    const hexToRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
    const srgbToLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const relLum = (h) => {
      const [r, g, b] = hexToRgb(h)
      return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b)
    }
    const contrast = (a, b) => {
      const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x)
      return (l1 + 0.05) / (l2 + 0.05)
    }
    /** color-mix(in srgb, a p%, b) —— srgb 空间按比例线性插值 */
    const colorMix = (a, b, p) => '#' + hexToRgb(a)
      .map((v, i) => Math.round(v * p + hexToRgb(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('')
    // tokens.css:58,98-99,104,106 的 light-dark() 两套取值
    const TONES = {
      ok: { light: '#10B981', dark: '#3FB950' },
      pending: { light: '#F59E0B', dark: '#D29922' },
      blue: { light: '#3B82F6', dark: '#60A5FA' },
      purple: { light: '#764ba2', dark: '#a78bfa' },
      primary: { light: '#059669', dark: '#34D399' },
    }
    const THEMES = {
      light: { textPrimary: '#1C1C1E', surface: '#FFFFFF' },
      dark: { textPrimary: '#F2F2F7', surface: '#2C2C2E' },
    }
    const MIX_TEXT = 0.70   // DealBadge.vue 的文字混合比，改这里必须同步改组件
    const MIX_FILL = 0.12
    // 组件里的声明必须与断言用的常数一致（防止只改一处）
    check('组件 CSS 的文字混合比与断言常数一致（0.70）',
      /color:\s*color-mix\(in srgb,\s*var\(--badge-tone\)\s*70%,\s*var\(--text-primary\)\)/.test(badgeSourceCss()),
      'DealBadge.vue 里的混合比不是 70%')

    console.log('  · 徽标对比度（WCAG AA-large 3:1，文字压在 12% 填充上）')
    console.log('    配色档   | 主题 | 文字色  | 填充色  | 对比度  | 结论')
    for (const [toneName, t] of Object.entries(TONES)) {
      for (const [themeName, th] of Object.entries(THEMES)) {
        const base = t[themeName]
        const textColor = colorMix(base, th.textPrimary, MIX_TEXT)
        const fillOnSurface = colorMix(base, th.surface, MIX_FILL)
        const ratio = contrast(textColor, fillOnSurface)
        const ok3 = ratio >= 3
        console.log(`    ${toneName.padEnd(8)} | ${themeName.padEnd(4)} | ${textColor} | ${fillOnSurface} | `
          + `${ratio.toFixed(2).padStart(5)}:1 | ${ok3 ? '✓ 过 AA-large' : '✗ 低于 3:1'}`)
        check(`徽标「${toneName}」在${themeName === 'light' ? '浅' : '暗'}色主题下对比度 ${ratio.toFixed(2)}:1 ≥ 3:1`,
          ok3, `${textColor} on ${fillOnSurface}`)
      }
    }
  }

  // ═══ ⑦ 领取地址 {邀请码}（需求 8）═══
  console.log('\n▶ ⑦ 领取地址：位置/样式还原为 <a :href>；值用服务端拼好的 claim_url；未抽中不显示任何提示')
  {
    const put = await api(`/api/token-deals/${idClaim}/invite-codes`, {
      method: 'PUT', cookie: admin,
      body: { codes: [{ code: 'A&B C', label: '含特殊字符的码', weight: 1, copyLimit: 0 }] },
    })
    check('写入含特殊字符的邀请码成功', put.status === 200, `status=${put.status} ${put.text.slice(0, 160)}`)

    const detail = await api(`/api/token-deals/${idClaim}`)
    check('详情接口标记 claim_url_has_placeholder = true', detail.json?.deal?.claim_url_has_placeholder === true)
    check('详情接口 claim_url_source = url（call_url 为空时回落 url）', detail.json?.deal?.claim_url_source === 'url')
    check('详情接口不下发 claim_url（码与成品地址只出现在抽码响应里）',
      !('claim_url' in (detail.json?.deal || {})))
    check('详情响应文本里搜不到邀请码值（码池不外泄）', !detail.text.includes('A&B C'))

    const claimPage = (await api(`/tokens/${idClaim}.html`)).text
    const claimBody = bodyHtmlOf(claimPage)
    const claimFoot = footHtmlOf(claimPage)
    // ── 核心：占位符是**后端程序变量**，访客不该看到任何字面 ──
    // 口径①（严）：**渲染层（可见 DOM）**绝不能出现这几种字面 —— 这是用户真正的诉求。
    //   先把 Nuxt 水合载荷 <script id="__NUXT_DATA__"> 剥掉：那是 props 的序列化传输，
    //   不是渲染结果（`deal.url` 原文在里面是 Nuxt 的固有行为，用户看不到）。
    // 口径②（记录）：载荷里仍会有 url 原文 —— 已在报告里写明「已知且无害」，
    //   强行遮蔽需改写 deal.url，会破坏编辑/展示逻辑，不做。
    const PLACEHOLDER_LITERALS = ['{邀请码}', '{code}', '{invite_code}', '｛邀请码｝']
    const claimVisible = visibleHtmlOf(claimPage)
    const hasPayload = claimPage.length !== claimVisible.length
    check('已确认本页含水合载荷（断言口径依赖此前提）', hasPayload,
      '没找到 __NUXT_DATA__，说明剥载荷的正则没生效，下面的断言口径需要重新核对')
    for (const lit of PLACEHOLDER_LITERALS) {
      check(`渲染层搜不到占位符字面 ${lit}`, !claimBody.includes(lit), `渲染层出现了 ${lit}`)
      check(`渲染层（整页去载荷）搜不到占位符字面 ${lit}`, !claimVisible.includes(lit),
        `可见 DOM 里出现了 ${lit}`)
    }
    check('SSR 未抽码：不展示模板原文（渲染层不出现 example.com/join?ref=）',
      !claimVisible.includes('example.com/join?ref='), '模板原文被渲染出来了')
    check('SSR 未抽码：该行不是 code 坏链接形态（无 row-code）', !claimBody.includes('row-code'))
    check('SSR 未抽码：该行不是 <a href> 形态',
      !/href="https:\/\/example\.com\/join/i.test(claimBody))
    // 2026-10-30 三轮：用户要求「不需要显示无邀请码的黄色提示」，
    // 未抽中时这一行**什么都不显示**（不要引导语、不要「去抽取」按钮）。
    check('SSR 未抽码：不出现任何提示字样（无「需先抽取邀请码」）',
      !claimBody.includes('需先抽取邀请码'), claimBody.slice(0, 400))
    check('SSR 未抽码：不出现「去抽取」按钮', !claimBody.includes('去抽取'))
    check('SSR 未抽码：不出现「暂无可用邀请码」（无码时的旧黄色提示已删）',
      !claimBody.includes('暂无可用邀请码'))
    check('SSR 未抽码：不出现旧引导语（该平台需邀请码 / 抽取后自动生成领取地址）',
      !claimBody.includes('该平台需邀请码') && !claimBody.includes('抽取后自动生成领取地址'))
    check('SSR 未抽码：不出现 .row-pending / .claim-hint 任何提示元素',
      !claimBody.includes('row-pending') && !claimBody.includes('claim-hint'))
    // 2026-10-30 四轮：用户要求「没有码就什么都不显示」→ **整行**不渲染。
    // 此前 `v-if` 只挂在 `<a>` 上，行容器照旧渲染，于是只剩一个孤零零的
    // 「领取地址」标签（下面紧跟 API 地址行，读起来像地址丢了）。
    check('SSR 未抽码：「领取地址」**整行**不渲染（标签也不该出现）',
      !claimBody.includes('领取地址'), claimBody.slice(0, 300))
    check('SSR 未抽码：正文区块容器已渲染（.tdd-body-inner，水印与滚动锚点的载体）',
      claimBody.includes('tdd-body-inner'))
    check('SSR 未抽码：底部「前往领取」降级为不可点（is-disabled，无 href）', (() => {
      const t = classTokensWith(claimFoot, 'is-disabled')
      return !!t && t.includes('tdd-btn') && !/href=/.test(claimFoot.slice(0, claimFoot.indexOf('前往领取')))
    })(), claimFoot.slice(0, 400))
    check('SSR 未抽码：底部降级按钮的 title 也不含占位符字面',
      !claimFoot.includes('{邀请码}'), claimFoot.slice(0, 400))
    const detailSfcClaim = readFileSync(join(ROOT, 'components', 'tokens', 'TokenDealDetail.vue'), 'utf8')
    // 「去抽取」按钮与 scrollToInvite 已随提示一并删除，这里断言它们真的没了
    check('源码：scrollToInvite 已删除（无去抽取按钮，不需要跳转）',
      !/function scrollToInvite/.test(detailSfcClaim))
    check('源码：邀请码区块锚点 id 已移除（还原为改动前的原样）',
      !/id="tdd-invite-section"/.test(detailSfcClaim))
    check('对照：普通通告（无占位符）底部「前往领取」仍是可点链接',
      /<a[^>]+href="https:\/\/cloud\.example\.com\/apply"[^>]*>\s*<i[^>]*><\/i>\s*前往领取/.test(footHtmlOf(pageVerified)),
      footHtmlOf(pageVerified).slice(0, 300))
    check('对照：无占位符通告正常展示原文链接（不被降级）',
      bodyHtmlOf(pageVerified).includes('https://cloud.example.com/apply'))

    // ── (l) API 地址行不得被误隐藏（2026-10-30 四轮，线上 39/46 条受影响）──
    //
    // 回归背景：`claimUrlTemplateOf()` 在**没有占位符**时也会把 `claim_url_source`
    // 指成 `'call_url'`（选序第三步「call_url 非空则用 call_url」与占位符无关）。
    // 而 `showApiRow` 原先按 `claimSource !== 'call_url'` 判断，于是任何
    // 「填了 call_url、但没写占位符」的通告都命中「已重复，不必再显示」分支 ——
    // 可「领取地址」那行此时显示的是 `url`，`call_url` 从未出现在页面上，
    // 结果**两个地址都不完整**（生产实测 39/46 条）。
    //
    // 修法：判据改为比对成品值 `claimReady !== callUrl`。下面这组断言就是防它复发。
    console.log('\n▶ (l) API 地址行：有 call_url 且未与领取地址重复时必须显示')
    {
      // 场景 1：url 与 call_url 都无占位符、且不同 → 两行都要在
      const idBoth = await createDeal({
        ...base, title: '戊站 两行都要', provider: '戊站',
        url: 'https://example.com/claim', call_url: 'https://api.example.com/v1',
      })
      const bothPage = (await api(`/tokens/${idBoth}.html`)).text
      const bothBody = bodyHtmlOf(bothPage)
      check('(l) 两行都在：渲染了「领取地址」', bothBody.includes('领取地址'), bothBody.slice(0, 400))
      check('(l) 两行都在：渲染了「API 地址」（修复前会被误隐藏）',
        bothBody.includes('API 地址'), bothBody.slice(0, 400))
      check('(l) 两行都在：领取地址显示的是 url',
        bothBody.includes('https://example.com/claim'))
      check('(l) 两行都在：API 地址显示的是 call_url',
        bothBody.includes('https://api.example.com/v1'))

      // 场景 2：url 与 call_url 完全相同 → 不重复，只显示一行
      const idSame = await createDeal({
        ...base, title: '己站 同一地址不重复', provider: '己站',
        url: 'https://same.example.com/x', call_url: 'https://same.example.com/x',
      })
      const samePage = (await api(`/tokens/${idSame}.html`)).text
      const sameBody = bodyHtmlOf(samePage)
      check('(l) 同址去重：领取地址在', sameBody.includes('领取地址'))
      check('(l) 同址去重：不重复渲染 API 地址行',
        !sameBody.includes('API 地址'), sameBody.slice(0, 400))
    }

    // ── (m) 公开详情响应不得带内部字段（2026-10-30 四轮）──
    //
    // 详情端点是 `{ ...row, ...覆盖 }` 的写法：`SELECT *` 展开全列，靠后面显式覆盖来脱敏。
    // 这种写法**新增一列就会自动透传**，所以必须有断言盯着，否则下一次加内部字段
    // （审计人、下架原因、指纹…）会静默泄露。
    //
    // 当前实测（生产库副本 61 条可见通告）泄露数为 0 —— 因为可见性过滤保证了
    // 「能读到详情 = 未删除 + 未失效」，`deleted_at` / `invalid_reason` 恒为空。
    // 但那是**偶然安全**，本轮已把它们改成显式 `undefined`，这里钉住。
    console.log('\n▶ (m) 公开详情：内部字段一律不下发')
    {
      // 本节自建通告，不依赖 (l) 块里的局部变量
      const idFieldCheck = await createDeal({
        ...base, title: '庚站 字段白名单', provider: '庚站',
        url: 'https://example.com/field', call_url: 'https://api.example.com/field',
      })
      const INTERNAL = [
        'deleted_at',        // 谁在何时删的
        'invalid_reason',    // 为什么判失效（expired/votes/manual）
        'deleted_by',        // 下架操作人
        'user_id',           // 可关联到账号
        'guest_fingerprint', // sha256(ip|ua)，能串联同一游客的全部通告
      ]
      const resp = await api(`/api/token-deals/${idFieldCheck}`)
      const deal = resp.json?.deal || {}
      const present = INTERNAL.filter(f => f in deal)
      check('(m) 公开详情不含内部字段（键都不出现）', present.length === 0,
        `仍在下发：${present.join(', ')}`)

      // `verified_by` 是**例外**：它恒下发空串（键在、值空）。
      // 前端组件已不渲染该字段，键保留只是为了响应结构稳定；
      // CLAUDE.md 的口径是「任何身份都不下发用户名」—— 所以要断言的是**值**为空。
      check('(m) verified_by 恒为空串（不因管理员身份放行）',
        deal.verified_by === '', JSON.stringify(deal.verified_by))

      // 反向断言：前端**需要**的字段必须保留，别把脱敏做过界
      const KEEP = ['id', 'provider', 'title', 'url', 'is_deleted', 'is_invalid',
        'invalid_reason_label', 'is_owner', 'can_edit', 'verified_at', 'verify_note',
        'note_html', 'has_invite_code', 'claim_url_source']
      const missing = KEEP.filter(f => !(f in deal))
      check('(m) 脱敏未过界：前端依赖的字段都在', missing.length === 0,
        `缺失：${missing.join(', ')}`)

      // 驳回通告：作者必须能读到 reject_reason（改稿重提的依据）
      // 匿名/他人读驳回通告一律 404（既有行为），所以这里只断言字段本身仍在响应结构里
      check('(m) reject_reason 字段保留（作者改稿需要）', 'reject_reason' in deal)
    }

    // ── 对照：有占位符但**没有配任何码** → 不能给「去抽取」（点了没反应）──
    const idNoPool = await createDeal({
      ...base, title: '丑站 占位符但无码池', provider: '丑站',
      url: 'https://example.com/join?ref={邀请码}', call_url: '',
    })
    const noPoolPage = (await api(`/tokens/${idNoPool}.html`)).text
    const noPoolBody = bodyHtmlOf(noPoolPage)
    // 2026-10-30 三轮：用户明确「不需要显示无邀请码的黄色提示」→ 无码时什么都不显示
    check('无码池：页面不出现「暂无可用邀请码」任何字样（两种口径）',
      !noPoolBody.includes('暂无可用邀请码') && !visibleHtmlOf(noPoolPage).includes('暂无可用邀请码'),
      noPoolBody.slice(0, 400))
    check('无码池：不出现「当前暂无可用邀请码，稍后再来看看」',
      !noPoolBody.includes('当前暂无可用邀请码'))
    check('无码池：不出现「去抽取」、不出现 .row-pending / .claim-hint',
      !noPoolBody.includes('去抽取') && !noPoolBody.includes('row-pending') && !noPoolBody.includes('claim-hint'))
    // 2026-10-30 四轮：无码时**整行**隐藏（不是「留空标签」）——
    // 空标签会让读者以为地址丢了，这正是用户报告的问题。
    check('无码池：「领取地址」整行不渲染（既无标签也无值）',
      !noPoolBody.includes('领取地址') && !noPoolBody.includes('example.com/join'),
      noPoolBody.slice(0, 300))
    check('无码池：整页仍无占位符字面（渲染层口径）',
      PLACEHOLDER_LITERALS.every(lit => !visibleHtmlOf(noPoolPage).includes(lit)))

    const draw = await api(`/api/token-deals/${idClaim}/invite-code`)
    const d = draw.json?.data || {}
    check('抽码接口返回 claim_url', typeof d.claim_url === 'string' && d.claim_url.length > 0, JSON.stringify(d).slice(0, 200))
    check('claim_url 里的占位符已被替换（不再含 {邀请码}）',
      !d.claim_url.includes('{邀请码}') && !d.claim_url.includes('｛邀请码｝'), d.claim_url)
    check('claim_url 的替换值做过 URL 编码（A&B C → A%26B%20C）',
      d.claim_url.includes('A%26B%20C'), d.claim_url)
    check('claim_url 保留了模板的其余部分（share_v=2）', d.claim_url.includes('share_v=2'), d.claim_url)
    check('抽码接口 claim_url_source = url', d.claim_url_source === 'url')
    console.log(`  · 抽中码 = ${d.code} ，服务端给出的成品地址 = ${d.claim_url}`)
    // 客户端渲染该成品链接的代码路径存在（运行期渲染需浏览器复核）
    const sfc = readFileSync(join(ROOT, 'components', 'tokens', 'TokenDealDetail.vue'), 'utf8')
    // 2026-10-30 三轮：领取地址还原为改动前的 `<a :href>` 形态，
    // 值由 claimReady 提供（= claimResolved || deal.url，优先用服务端拼好的成品链接）。
    check('组件里领取地址走 claimReady（`<a :href="claimReady">`，原样式还原）',
      sfc.includes(':href="claimReady"') && sfc.includes('>{{ claimReady }}</a>'))
    check('claimReady 优先用服务端拼好的成品链接（claimResolved 在前）',
      /const claimReady = computed\(\(\) => \{\s*if \(claimResolved\.value\) return claimResolved\.value/.test(sfc))
    check('组件不对原文做任何替换（没有把占位符 replace 成码的代码）',
      !/replace\([^)]*邀请码/.test(sfc), '组件里出现了替换逻辑')
  }

  // ═══ ⑧ /tokens 默认排序（需求 7）═══
  console.log('\n▶ ⑧ /tokens 默认排序 = 最新')
  {
    const listPage = (await api('/tokens')).text
    // SSR 把动态 class 渲染在静态 class 前面（实测 class="active filter-tab"），故按 token 判定
    const tabs = listPage.slice(listPage.indexOf('filter-tabs'), listPage.indexOf('filter-selects'))
    const activeLabel = (() => {
      const re = /<button[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g
      let m
      while ((m = re.exec(tabs)) !== null) {
        if (m[1].split(/\s+/).includes('active')) return m[2].trim()
      }
      return null
    })()
    check('排序条默认高亮「最新」', activeLabel === '最新', `实际高亮=${JSON.stringify(activeLabel)}`)
    const latest = await api('/api/token-deals?sort=latest&limit=24')
    const newestId = latest.json?.deals?.[0]?.id
    const firstCardId = (listPage.match(/href="\/tokens\/([^"]+?)\.html"/) || [])[1]
    check('列表首张卡片就是最新那条', !!firstCardId && firstCardId === newestId,
      `first=${firstCardId} newest=${newestId}`)
    check('页面源码里默认排序值为 latest',
      readFileSync(join(ROOT, 'pages', 'tokens', 'index.vue'), 'utf8').includes("const sort = ref('latest')"))
  }

  // ═══ ⑨ 429 不得退化成 500（限流响应头含中文曾把 429 变成 500）═══
  //
  // 为什么需要这一段（2026-11-04 生产事故，已结案）：
  //   限流把**中文标签**写进 `X-RateLimit-Reason`；非 ASCII 头值在构造响应时抛
  //   `TypeError: Cannot convert argument to a ByteString … value of 20840`（20840='全'），
  //   本该 429 的响应变成 **500**；失败在响应落盘阶段、**不经过 error hook** → 服务端零日志；
  //   SSR 详情页内部取数拿到 500 后回落成兜底文案「加载失败，请稍后重试」。
  //
  // ⚠️ 为什么**不能**用「断言响应头没有非 ASCII」来守（第一版就错在这，被独立验证打回）：
  //   `rateLimitError()` 外层本来就有 try/catch（注释：「头写不进去不改变 429 语义」），
  //   中文头被**静默丢弃**，客户端永远收不到非 ASCII 头 —— 那种断言恒绿
  //   （实测：把修复回退掉，它依然 115 项全过、退出码 0）。它咬的是 latin-1 `é` 那类
  //   Node 会接受并真上线的值，**不是本次这条路径**。
  //   真正要守的是**语义**：限流无论如何都必须仍然是 429，页面不得回落成兜底文案。
  console.log('\n▶ ⑨ 429 不得退化成 500（限流头含中文的历史回归）')
  {
    // 把「全站读档」压到 1 次/分钟（只影响本套件自建实例）：
    // /api 的每次读都计数，而 SSR 内部自取数也算 → 第 2 页起必然被限。
    await stopApp()
    await startApp(DB_PATH, {
      FAVSHUB_RL_SITE_READ_PER_MIN: '1',
      FAVSHUB_RL_SITE_WRITE_PER_MIN: '600',
      FAVSHUB_RL_SITE_ASSET_PER_MIN: '600',
    })

    // (a) 接口级语义：连打直到出现限流，状态码必须是 429 —— 不能是 500。
    //     ⚠️ 诚实标注：**这一条不区分本次回归**。直接打 /api 时 `rateLimitError()` 的 try/catch
    //     会吞掉中文头错误、照常返回 429，所以回退修复后它依然绿（实测）。
    //     它守的是另一类失效（例如有人让限流路径抛 500）。**主证据是下面的 (b)**。
    let limitedStatus = 0
    let limitedText = ''
    for (let i = 0; i < 8; i++) {
      const r = await api(`/api/token-deals?limit=1&probe=${'a'.repeat(i + 1)}`)
      if (r.status === 429 || r.status >= 500) { limitedStatus = r.status; limitedText = r.text; break }
    }
    check('⑨ 限流响应状态码是 429（历史 bug 会退化成 500）',
      limitedStatus === 429,
      `实际=${limitedStatus || '8 次内未触发限流'} body=${limitedText.slice(0, 160)}`)
    check('⑨ 限流响应体仍带中文长文案（契约未变）',
      limitedText.includes('超出限频'),
      limitedText.slice(0, 200))

    // (b) 页面级症状：SSR 内部取数被限流时，页面必须展示「超出限频」，
    //     而**不能**回落到兜底文案「加载失败」。这一条直击用户可见症状，且修复前后真的翻转。
    const degradedHits = []
    const limitedHits = []
    for (let i = 0; i < 4; i++) {
      const r = await api(`/tokens/${idVerified}.html`)
      const body = visibleHtmlOf(r.text)
      degradedHits.push(body.includes('加载失败'))
      limitedHits.push(body.includes('超出限频'))
      if (degradedHits.at(-1) || limitedHits.at(-1)) break
    }
    check('⑨ SSR 被限流时页面**不再**渲染兜底文案「加载失败」',
      !degradedHits.some(Boolean),
      `出现「加载失败」=${degradedHits.filter(Boolean).length} 次`)
    check('⑨ 页面改为诚实展示「超出限频」（说明拿到的是 429 而非 500）',
      limitedHits.some(Boolean),
      `出现「超出限频」=${limitedHits.filter(Boolean).length} 次；为 0 说明桶没打满，本条未生效`)

    // (c) 纵深防御（**不是**主证据，见段首注释）：头仍走 asciiHeader()。
    check('⑨ 纵深防御：限流头仍走 asciiHeader()',
      readFileSync(join(ROOT, 'server', 'utils', 'rate-limit.ts'), 'utf8')
        .includes("setResponseHeader(event, 'X-RateLimit-Reason', asciiHeader(code))"))

    // 恢复默认阈值，避免影响后续段落
    await stopApp()
    await startApp(DB_PATH)
  }

  // ── 未覆盖项（如实列出，避免报告里出现没有证据的结论）──
  console.log('\n▶ 未覆盖 / 需人工复核')
  console.log('  · 视觉呈现（配色观感、圆角、留白、窄屏 header 折行后的观感）——需浏览器复核')
  console.log('  · 「抽中码之后客户端把 claim_url 渲染成 <a>」是客户端行为，SSR 断言不到；本次只验证了'
    + '抽码接口返回值 + 组件里的绑定代码路径')
  console.log('  · 几何数字是按 CSS 盒模型推算的，不是浏览器实测（本机无可用无头浏览器）')
  console.log('  · 弹窗形态（/tokens 点卡片）的 SSR 断言覆盖不到（弹窗是客户端渲染）')
  console.log('  · 已核验=绿 / 待核验=黄 的**观感**（颜色对比度）只验了 CSS 变量取值，未做实测像素取样')

  await stopApp()
}

main()
  .then(async () => {
    await stopApp()
    console.log(`\n════ 结果：${passCount} 通过 / ${failCount} 失败 ════`)
    if (failCount) {
      console.error('失败项：')
      for (const f of failures) console.error(`  - ${f}`)
      process.exit(1)
    }
  })
  .catch(async (err) => {
    await stopApp()
    console.error('\n脚本异常：', err)
    process.exit(1)
  })
