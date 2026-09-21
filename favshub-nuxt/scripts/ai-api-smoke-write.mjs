// AI 数据操作能力 — 写入 / 删除 / 越权隔离端到端测试（约 75 项断言）
//
// 覆盖:
//   1. 书签写删（单条 / 批量 / 上限 / 校验 / 唯一约束 / dry_run 不落库 / 跨用户 404）
//   2. 文件夹（父子校验 / 循环引用 / 归属 403 / 删除语义）
//   3. 提示词（版本自增 / 软删恢复 / 物理删除 / 跨用户隔离）
//   4. 标签（幂等 / 管理员专属删除）
//   5. Token 通告（管理员直上线 vs 普通用户 pending / 管理员可删他人）
//   6. 限频（专用 IP 触发 429）
//   7. 审计（状态码覆盖 / 绝不记录请求体内容）
//
// 用法:
//   1) 准备临时库（**切勿指向生产库**）并开放注册 —— 见 ai-api-smoke-read.mjs 头部说明
//   2) 启动被测服务（三项环境变量都要）:
//        NUXT_DB_PATH=/tmp/favshub-ai-smoke.db \
//        NUXT_JWT_SECRET=smoke-secret-key \
//        NUXT_ADMIN_USERS=smokeadmin \
//        NUXT_TRUST_PROXY=true \
//        PORT=3210 HOST=127.0.0.1 node .output/server/index.mjs
//   3) node scripts/ai-api-smoke-write.mjs [baseUrl] [dbPath]
//
// 顺序: 建议先跑 ai-api-smoke-read.mjs 再跑本脚本。
//       本脚本末尾会打满限频桶，跑完后同一分钟内继续压测会收到 429。
//
// NUXT_TRUST_PROXY=true 的作用: 让 IP 级限频读取 X-Forwarded-For，
// 从而把「限频压测」隔离到专用 IP（198.51.100.77），不污染其余用例。
//
// 退出码: 0 全通过 / 1 有失败项
const BASE = process.argv[2] || 'http://127.0.0.1:3210'
const DB_PATH = process.argv[3] || process.env.SMOKE_DB || ''
const BURST_IP = '198.51.100.77'

const ADMIN_USER = 'smokeadmin'
const USER_A = 'aiskill_a'
const USER_B = 'aiskill_b'
const PWD = 'SmokeTest123'

/** 运行标识：让 URL 在重复运行时不撞唯一约束 */
const RUN = Date.now().toString(36)
/** 敏感标记：写入数据库但**绝不应**出现在审计日志里 */
const SENSITIVE_MARKER = 'SMOKE_SENSITIVE_' + RUN

let pass = 0
let fail = 0
const failures = []
const warnings = []

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  [PASS]', name) }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  [FAIL]', name, detail) }
}
function warn(msg) { warnings.push(msg); console.log('  [WARN]', msg) }

// ─── HTTP 客户端 ────────────────────────────────────────────────

function makeClient() {
  let cookie = ''
  return {
    get cookie() { return cookie },
    get jwt() { return cookie ? cookie.slice('favshub_token='.length) : '' },
    async req(path, opts = {}) {
      const headers = { ...(opts.headers || {}) }
      if (cookie && !headers.cookie) headers.cookie = cookie
      const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' })
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const sc of setCookies) {
        const kv = sc.split(';')[0]
        if (kv.startsWith('favshub_token=')) cookie = kv
      }
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* HTML 或空体 */ }
      return { status: res.status, json, text, headers: res.headers }
    },
  }
}

const admin = makeClient()
const userA = makeClient()
const userB = makeClient()
const anon = makeClient()

async function ensureAuth(client, username, nickname) {
  const r = await client.req('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PWD, nickname }),
  })
  if (r.status === 200) return { status: 200, isAdmin: r.json?.user?.is_admin }
  if (r.status === 409) {
    const l = await client.req('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PWD }),
    })
    return { status: l.status, isAdmin: l.json?.user?.is_admin }
  }
  return { status: r.status, isAdmin: r.json?.user?.is_admin, raw: r.json }
}

async function createToken(client, name, scopes) {
  const r = await client.req('/api/user/api-tokens', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, scopes }),
  })
  return { status: r.status, plain: r.json?.token || null, id: r.json?.token_info?.id ?? null, json: r.json }
}

/** Bearer 请求（绝不携带 cookie，确保走 PAT 通道） */
function api(path, token, opts = {}) {
  const headers = { ...(opts.headers || {}), authorization: 'Bearer ' + token }
  return anon.req(path, { ...opts, headers })
}
const jsonApi = (path, token, method, body) =>
  api(path, token, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

/** 惰性打开只读 DB */
let _db = null
let _dbTried = false
async function openDb() {
  if (_dbTried) return _db
  _dbTried = true
  if (!DB_PATH) return null
  try {
    const mod = await import('better-sqlite3')
    _db = new mod.default(DB_PATH, { readonly: true, fileMustExist: true })
  } catch (e) {
    warn(`无法打开 DB 做库级断言（${DB_PATH}）: ${e.message}`)
    _db = null
  }
  return _db
}

// ════════════════════════════════════════════════════════════════
console.log('=== 0. 账号与令牌准备 ===')
let adminTok, tokA, tokB
{
  const a = await ensureAuth(admin, ADMIN_USER, 'AI 冒烟管理员')
  check('管理员账号可用', a.status === 200, 'status=' + a.status)
  // is_admin 仅反映 DB 字段；管理员身份的真正证明是能创建 delete scope 令牌（见下）
  check('管理员响应含 is_admin 字段', typeof a.isAdmin === 'boolean', 'is_admin=' + a.isAdmin)

  const b = await ensureAuth(userA, USER_A, 'AI 冒烟用户 A')
  check('用户 A 可用', b.status === 200, 'status=' + b.status)
  check('用户 A 非管理员', b.isAdmin === false, 'is_admin=' + b.isAdmin)

  const c = await ensureAuth(userB, USER_B, 'AI 冒烟用户 B')
  check('用户 B 可用', c.status === 200, 'status=' + c.status)

  const at = await createToken(admin, '冒烟-管理员全权', ['read', 'write', 'delete'])
  check('管理员创建 read+write+delete 令牌 → 200（证明管理员身份生效）', at.status === 200, 'status=' + at.status + ' ' + JSON.stringify(at.json))
  adminTok = at.plain

  const a1 = await createToken(userA, '冒烟-A读写', ['read', 'write'])
  check('用户 A 创建 read+write 令牌 → 200', a1.status === 200, 'status=' + a1.status + ' ' + JSON.stringify(a1.json))
  tokA = a1.plain

  const a2 = await createToken(userA, '冒烟-A越权删除', ['delete'])
  check('普通用户创建 delete 令牌 → 403（关键）', a2.status === 403, 'status=' + a2.status)

  const b1 = await createToken(userB, '冒烟-B读写', ['read', 'write'])
  check('用户 B 创建 read+write 令牌 → 200', b1.status === 200, 'status=' + b1.status)
  tokB = b1.plain
}

// ─── 1. 书签 ────────────────────────────────────────────────────
console.log('=== 1. 书签写入与隔离 ===')
let bmA = null
let bmAdmin = null
let folderA = null
let folderB = null
{
  const url1 = `https://smoke.example.com/${RUN}/a1`
  const c1 = await jsonApi('/api/ai/bookmarks', tokA, 'POST', { title: `冒烟书签 ${SENSITIVE_MARKER}`, url: url1 })
  check('A 单条创建书签 → 200', c1.status === 200, 'status=' + c1.status + ' ' + JSON.stringify(c1.json).slice(0, 160))
  check('返回 count=1', c1.json?.count === 1, 'count=' + c1.json?.count)
  bmA = c1.json?.created?.[0]
  check('非管理员写入强制 login_required=1', bmA?.login_required === 1, 'login_required=' + bmA?.login_required)
  check('source 标记为 api', bmA?.source === 'api', 'source=' + bmA?.source)

  const batch = await jsonApi('/api/ai/bookmarks', tokA, 'POST', {
    items: [1, 2, 3].map(i => ({ title: `批量书签 ${i}`, url: `https://smoke.example.com/${RUN}/batch${i}` })),
  })
  check('A 批量创建 3 条 → 200', batch.status === 200 && batch.json?.count === 3, 'status=' + batch.status + ' count=' + batch.json?.count)

  const tooMany = await jsonApi('/api/ai/bookmarks', tokA, 'POST', {
    items: Array.from({ length: 51 }, (_, i) => ({ title: 'x' + i, url: `https://smoke.example.com/${RUN}/over${i}` })),
  })
  check('批量 51 条 → 400（超上限）', tooMany.status === 400, 'status=' + tooMany.status)
  check('超限文案含 50', /50/.test(tooMany.json?.error || ''), tooMany.json?.error)

  const empty = await jsonApi('/api/ai/bookmarks', tokA, 'POST', {})
  check('空请求体 → 400', empty.status === 400, 'status=' + empty.status)

  const noUrl = await jsonApi('/api/ai/bookmarks', tokA, 'POST', { title: '缺 URL' })
  check('缺 url → 400', noUrl.status === 400, 'status=' + noUrl.status)

  const danger = await jsonApi('/api/ai/bookmarks', tokA, 'POST', { title: '危险协议', url: 'javascript:alert(1)' })
  check('javascript: 协议 → 400', danger.status === 400, 'status=' + danger.status)
  check('危险协议文案可读', /协议/.test(danger.json?.error || ''), danger.json?.error)

  const dup = await jsonApi('/api/ai/bookmarks', tokA, 'POST', { title: '重复 URL', url: url1 })
  check('同用户重复 URL → 409', dup.status === 409, 'status=' + dup.status)

  // dry_run 不落库
  const before = (await api('/api/ai/bookmarks?limit=1', tokA)).json?.pagination?.total
  const dry = await jsonApi('/api/ai/bookmarks', tokA, 'POST', { title: '预演书签', url: `https://smoke.example.com/${RUN}/dry`, dry_run: true })
  check('dry_run 创建 → 200 且 dry_run=true', dry.status === 200 && dry.json?.dry_run === true, 'status=' + dry.status + ' ' + JSON.stringify(dry.json).slice(0, 120))
  check('dry_run 返回 planned_count', dry.json?.planned_count === 1, 'planned_count=' + dry.json?.planned_count)
  const after = (await api('/api/ai/bookmarks?limit=1', tokA)).json?.pagination?.total
  check('dry_run 后总量不变（未落库）', before === after, `before=${before} after=${after}`)

  // 更新
  const up = await jsonApi('/api/ai/bookmarks/' + bmA.id, tokA, 'PUT', { title: '冒烟书签（已改名）' })
  check('A 更新自己的书签 → 200', up.status === 200 && up.json?.bookmark?.title === '冒烟书签（已改名）', 'status=' + up.status)
  const up404 = await jsonApi('/api/ai/bookmarks/999999999', tokA, 'PUT', { title: 'x' })
  check('更新不存在的书签 → 404', up404.status === 404, 'status=' + up404.status)

  // 跨用户隔离
  const crossUp = await jsonApi('/api/ai/bookmarks/' + bmA.id, tokB, 'PUT', { title: '越权改名' })
  check('B 更新 A 的书签 → 404（不泄露存在性）', crossUp.status === 404, 'status=' + crossUp.status)
  const crossDel = await jsonApi('/api/ai/bookmarks/' + bmA.id, adminTok, 'DELETE', { confirm: true })
  check('管理员删除 A 的书签 → 404（AI 通道强制归属隔离）', crossDel.status === 404, 'status=' + crossDel.status)

  // 删除：confirm / scope
  const noConfirm = await jsonApi('/api/ai/bookmarks/' + bmA.id, adminTok, 'DELETE', {})
  check('删除缺 confirm → 400', noConfirm.status === 400, 'status=' + noConfirm.status)
  check('缺 confirm 文案含 confirm', /confirm/.test(noConfirm.json?.error || ''), noConfirm.json?.error)

  const noScopeDel = await jsonApi('/api/ai/bookmarks/' + bmA.id, tokA, 'DELETE', { confirm: true })
  check('write 令牌删除书签 → 403（无 delete scope）', noScopeDel.status === 403, 'status=' + noScopeDel.status)

  // 跨用户 dry_run 同样受归属隔离 —— dry_run 不得成为存在性探针
  // （实现顺序：先按 user_id 查行 → 404，再判断 dry_run；否则会把他人 title/url 泄露出去）
  const dryCross = await jsonApi('/api/ai/bookmarks/' + bmA.id, adminTok, 'DELETE', { confirm: true, dry_run: true })
  check('跨用户 dry_run 删除 → 404（归属隔离不可绕过）', dryCross.status === 404, 'status=' + dryCross.status + ' ' + JSON.stringify(dryCross.json).slice(0, 120))
  const stillThere = await api('/api/ai/bookmarks?q=' + encodeURIComponent('冒烟书签（已改名）'), tokA)
  check('跨用户 dry_run 后书签仍存在', (stillThere.json?.bookmarks || []).some(b => b.id === bmA.id), 'ids=' + JSON.stringify((stillThere.json?.bookmarks || []).map(b => b.id)))

  // 管理员删自己的书签（成功路径）
  const ac = await jsonApi('/api/ai/bookmarks', adminTok, 'POST', { title: '管理员的书签', url: `https://smoke.example.com/${RUN}/admin1` })
  bmAdmin = ac.json?.created?.[0]
  check('管理员创建书签 → 200', ac.status === 200 && !!bmAdmin, 'status=' + ac.status)

  // dry_run 用「自己的书签」验证（需 delete scope，故只能由管理员执行）
  const dryOwn = await jsonApi('/api/ai/bookmarks/' + bmAdmin.id, adminTok, 'DELETE', { confirm: true, dry_run: true })
  check('dry_run 删除自己的书签 → 200 且 dry_run=true', dryOwn.status === 200 && dryOwn.json?.dry_run === true, 'status=' + dryOwn.status + ' ' + JSON.stringify(dryOwn.json).slice(0, 120))
  check('dry_run 回显待删除对象 id', dryOwn.json?.changes?.delete?.id === bmAdmin.id, JSON.stringify(dryOwn.json?.changes))
  const stillOwn = await api('/api/ai/bookmarks?q=' + encodeURIComponent('管理员的书签'), adminTok)
  check('dry_run 后书签仍存在（未落库）', (stillOwn.json?.bookmarks || []).some(b => b.id === bmAdmin.id), 'ids=' + JSON.stringify((stillOwn.json?.bookmarks || []).map(b => b.id)))

  const delOk = await jsonApi('/api/ai/bookmarks/' + bmAdmin.id, adminTok, 'DELETE', { confirm: true })
  check('管理员删除自己的书签 → 200', delOk.status === 200 && delOk.json?.success === true, 'status=' + delOk.status + ' ' + JSON.stringify(delOk.json))
}

// ─── 2. 文件夹 ──────────────────────────────────────────────────
console.log('=== 2. 文件夹 ===')
let childA = null
{
  const fA = await jsonApi('/api/ai/folders', tokA, 'POST', { name: '冒烟文件夹 A' })
  check('A 创建文件夹 → 200', fA.status === 200 && !!fA.json?.folder?.id, 'status=' + fA.status)
  folderA = fA.json?.folder

  const fB = await jsonApi('/api/ai/folders', tokB, 'POST', { name: '冒烟文件夹 B' })
  folderB = fB.json?.folder
  check('B 创建文件夹 → 200', fB.status === 200)

  const child = await jsonApi('/api/ai/folders', tokA, 'POST', { name: '冒烟子文件夹', parent_id: folderA.id })
  check('A 创建子文件夹 → 200', child.status === 200 && child.json?.folder?.parent_id === folderA.id, 'status=' + child.status)
  childA = child.json?.folder

  const crossParent = await jsonApi('/api/ai/folders', tokA, 'POST', { name: '越权子文件夹', parent_id: folderB.id })
  check('A 在 B 的文件夹下创建 → 403', crossParent.status === 403, 'status=' + crossParent.status)

  const ghostParent = await jsonApi('/api/ai/folders', tokA, 'POST', { name: '幽灵父级', parent_id: 999999999 })
  check('父文件夹不存在 → 400', ghostParent.status === 400, 'status=' + ghostParent.status)

  const noName = await jsonApi('/api/ai/folders', tokA, 'POST', { name: '  ' })
  check('文件夹名为空 → 400', noName.status === 400, 'status=' + noName.status)

  const up = await jsonApi('/api/ai/folders/' + folderA.id, tokA, 'PUT', { name: '冒烟文件夹 A（改名）' })
  check('A 更新文件夹 → 200', up.status === 200 && up.json?.folder?.name === '冒烟文件夹 A（改名）', 'status=' + up.status)

  const cyc = await jsonApi('/api/ai/folders/' + folderA.id, tokA, 'PUT', { parent_id: childA.id })
  check('循环引用（父设为自己的子）→ 400', cyc.status === 400, 'status=' + cyc.status)

  const crossUp = await jsonApi('/api/ai/folders/' + folderB.id, tokA, 'PUT', { name: '越权改名' })
  check('A 更新 B 的文件夹 → 404', crossUp.status === 404, 'status=' + crossUp.status)

  const noConfirm = await jsonApi('/api/ai/folders/' + folderA.id, adminTok, 'DELETE', {})
  check('删除文件夹缺 confirm → 400', noConfirm.status === 400, 'status=' + noConfirm.status)

  const noScope = await jsonApi('/api/ai/folders/' + folderA.id, tokA, 'DELETE', { confirm: true })
  check('write 令牌删除文件夹 → 403', noScope.status === 403, 'status=' + noScope.status)

  // 成功删除：管理员建自己的文件夹 + 一个书签，删除后书签应解除归属
  const af = await jsonApi('/api/ai/folders', adminTok, 'POST', { name: '管理员文件夹' })
  const afId = af.json?.folder?.id
  await jsonApi('/api/ai/bookmarks', adminTok, 'POST', { title: '管理员夹内书签', url: `https://smoke.example.com/${RUN}/infolder`, folder_id: afId })
  const delOk = await jsonApi('/api/ai/folders/' + afId, adminTok, 'DELETE', { confirm: true })
  check('管理员删除自己的文件夹 → 200', delOk.status === 200 && delOk.json?.success === true, 'status=' + delOk.status + ' ' + JSON.stringify(delOk.json))
  check('删除文件夹返回受影响书签数', delOk.json?.detached_bookmarks === 1, 'detached=' + delOk.json?.detached_bookmarks)

  const after = await api('/api/ai/bookmarks?q=' + encodeURIComponent('管理员夹内书签'), adminTok)
  const stillThere = after.json?.bookmarks?.find(b => b.title === '管理员夹内书签')
  check('夹内书签未被删除且已解除归属', !!stillThere && stillThere.folder_id === null, JSON.stringify(stillThere?.folder_id))
}

// ─── 3. 提示词 ──────────────────────────────────────────────────
console.log('=== 3. 提示词 ===')
let promptA = null
{
  const c = await jsonApi('/api/ai/prompts', tokA, 'POST', {
    title: '冒烟提示词 A', content: '你是一个测试助手。', description: '冒烟用',
  })
  check('A 创建提示词 → 200', c.status === 200 && !!c.json?.prompt?.id, 'status=' + c.status + ' ' + JSON.stringify(c.json).slice(0, 160))
  promptA = c.json?.prompt
  check('初始 version_count=1', promptA?.version_count === 1, 'version_count=' + promptA?.version_count)
  check('非管理员写入强制 login_required=1', promptA?.login_required === 1, 'login_required=' + promptA?.login_required)

  const noTitle = await jsonApi('/api/ai/prompts', tokA, 'POST', { content: 'x' })
  check('缺 title/content → 400', noTitle.status === 400, 'status=' + noTitle.status)

  const g = await api('/api/ai/prompts/' + promptA.id, tokA)
  check('A 读取自己的提示词详情 → 200', g.status === 200, 'status=' + g.status)

  const up = await jsonApi('/api/ai/prompts/' + promptA.id, tokA, 'PUT', { content: '你是一个测试助手（v2）。' })
  check('A 更新正文 → 200 且版本自增', up.status === 200 && up.json?.prompt?.version_count === 2, 'status=' + up.status + ' version_count=' + up.json?.prompt?.version_count)

  const up404 = await jsonApi('/api/ai/prompts/00000000-0000-0000-0000-000000000000', tokA, 'PUT', { title: 'x' })
  check('更新不存在的提示词 → 404', up404.status === 404, 'status=' + up404.status)

  const crossGet = await api('/api/ai/prompts/' + promptA.id, tokB)
  check('B 读取 A 的提示词 → 404（隔离）', crossGet.status === 404, 'status=' + crossGet.status)

  const crossUp = await jsonApi('/api/ai/prompts/' + promptA.id, tokB, 'PUT', { title: '越权改名' })
  check('B 更新 A 的提示词 → 404', crossUp.status === 404, 'status=' + crossUp.status)

  const crossDel = await jsonApi('/api/ai/prompts/' + promptA.id, adminTok, 'DELETE', { confirm: true })
  check('管理员删除 A 的提示词 → 404（AI 通道不开放跨用户编辑）', crossDel.status === 404, 'status=' + crossDel.status)

  const noConfirm = await jsonApi('/api/ai/prompts/' + promptA.id, adminTok, 'DELETE', {})
  check('删除提示词缺 confirm → 400', noConfirm.status === 400, 'status=' + noConfirm.status)

  const noScope = await jsonApi('/api/ai/prompts/' + promptA.id, tokA, 'DELETE', { confirm: true })
  check('write 令牌删除提示词 → 403', noScope.status === 403, 'status=' + noScope.status)

  // 管理员自己的提示词：软删 → 恢复 → 物理删
  const ap = await jsonApi('/api/ai/prompts', adminTok, 'POST', { title: '管理员提示词', content: 'x' })
  const apId = ap.json?.prompt?.id
  const soft = await jsonApi('/api/ai/prompts/' + apId, adminTok, 'DELETE', { confirm: true })
  check('软删除 → 200 且可恢复', soft.status === 200 && soft.json?.recoverable === true, JSON.stringify(soft.json))
  const restored = await jsonApi('/api/ai/prompts/' + apId, adminTok, 'PUT', { restore: true })
  check('从回收站恢复 → 200', restored.status === 200 && restored.json?.restored === true, 'status=' + restored.status)
  const perm = await jsonApi('/api/ai/prompts/' + apId, adminTok, 'DELETE', { confirm: true, permanent: true })
  check('物理删除 → 200 且不可恢复', perm.status === 200 && perm.json?.permanent === true && perm.json?.recoverable === false, JSON.stringify(perm.json))
}

// ─── 4. 标签 ────────────────────────────────────────────────────
console.log('=== 4. 标签 ===')
{
  const c = await jsonApi('/api/ai/tags', tokA, 'POST', { name: '冒烟标签-' + RUN })
  check('A 创建标签 → 200', c.status === 200 && !!c.json?.tag?.id, 'status=' + c.status)
  const tagId = c.json?.tag?.id

  const again = await jsonApi('/api/ai/tags', tokA, 'POST', { name: '冒烟标签-' + RUN })
  check('同名标签幂等（existed=true）', again.status === 200 && again.json?.existed === true, JSON.stringify(again.json).slice(0, 120))

  const longName = await jsonApi('/api/ai/tags', tokA, 'POST', { name: 'x'.repeat(65) })
  check('标签名超长（65）→ 400', longName.status === 400, 'status=' + longName.status)

  const noScope = await jsonApi('/api/ai/tags/' + tagId, tokA, 'DELETE', { confirm: true })
  check('write 令牌删除标签 → 403', noScope.status === 403, 'status=' + noScope.status)

  const noConfirm = await jsonApi('/api/ai/tags/' + tagId, adminTok, 'DELETE', {})
  check('管理员删除标签缺 confirm → 400', noConfirm.status === 400, 'status=' + noConfirm.status)

  const del = await jsonApi('/api/ai/tags/' + tagId, adminTok, 'DELETE', { confirm: true })
  check('管理员删除标签 → 200（与 Web 端点语义一致）', del.status === 200 && del.json?.success === true, 'status=' + del.status + ' ' + JSON.stringify(del.json))
}

// ─── 5. Token 通告 ──────────────────────────────────────────────
console.log('=== 5. Token 白嫖通告 ===')
let dealA = null
{
  const a = await jsonApi('/api/ai/token-deals', tokA, 'POST', {
    provider: '冒烟服务商', title: '冒烟通告 A', url: `https://smoke.example.com/${RUN}/deal`,
    region: 'cn', quality: '中品', source_tag: 'community',
  })
  check('A 发布通告 → 200', a.status === 200, 'status=' + a.status + ' ' + JSON.stringify(a.json).slice(0, 160))
  check('普通用户发布 → status=pending', a.json?.status === 'pending', 'status=' + a.json?.status)
  dealA = a.json?.token_deal?.id

  const ad = await jsonApi('/api/ai/token-deals', adminTok, 'POST', {
    provider: '冒烟服务商', title: '冒烟通告（管理员）', url: `https://smoke.example.com/${RUN}/deal-admin`,
    region: 'global', quality: '上品', source_tag: 'official',
  })
  check('管理员发布通告 → status=approved', ad.status === 200 && ad.json?.status === 'approved', 'status=' + ad.json?.status)
  const adminDealId = ad.json?.token_deal?.id

  const badRegion = await jsonApi('/api/ai/token-deals', tokA, 'POST', {
    provider: 'x', title: 'y', url: 'https://smoke.example.com/x', region: 'mars',
  })
  check('非法 region → 400', badRegion.status === 400, 'status=' + badRegion.status)

  // ── 更新（部分更新语义）─────────────────────────────────────
  const updDry = await jsonApi('/api/ai/token-deals/' + dealA, tokA, 'PUT', {
    title: '冒烟通告 A（改标题）', dry_run: true,
  })
  check('A 更新自己的通告 dry_run → 200', updDry.status === 200 && updDry.json?.dry_run === true, 'status=' + updDry.status + ' ' + JSON.stringify(updDry.json).slice(0, 160))
  check('dry_run 返回 changes.title', updDry.json?.changes?.title?.to === '冒烟通告 A（改标题）', JSON.stringify(updDry.json?.changes))

  const afterDry = await api('/api/ai/token-deals?mine=1&limit=100', tokA)
  const stillOld = afterDry.json?.token_deals?.find(d => d.id === dealA)
  check('dry_run 未落库（标题仍是原值）', stillOld?.title === '冒烟通告 A', 'title=' + stillOld?.title)

  const upd = await jsonApi('/api/ai/token-deals/' + dealA, tokA, 'PUT', { title: '冒烟通告 A（改标题）' })
  check('A 更新自己的通告 → 200', upd.status === 200, 'status=' + upd.status + ' ' + JSON.stringify(upd.json).slice(0, 160))
  check('标题已变更', upd.json?.token_deal?.title === '冒烟通告 A（改标题）', 'title=' + upd.json?.token_deal?.title)
  check('未传字段保持原值（provider）', upd.json?.token_deal?.provider === '冒烟服务商', 'provider=' + upd.json?.token_deal?.provider)
  check('未传字段保持原值（region）', upd.json?.token_deal?.region === 'cn', 'region=' + upd.json?.token_deal?.region)
  check('未传字段保持原值（quality）', upd.json?.token_deal?.quality === '中品', 'quality=' + upd.json?.token_deal?.quality)

  const camel = await jsonApi('/api/ai/token-deals/' + dealA, tokA, 'PUT', {
    call_url: 'https://api.smoke.example.com/v1', source_tag: 'relay',
  })
  check('camelCase/snake_case 别名均可写入', camel.status === 200 && camel.json?.token_deal?.call_url === 'https://api.smoke.example.com/v1' && camel.json?.token_deal?.source_tag === 'relay', JSON.stringify(camel.json?.token_deal).slice(0, 200))

  const emptyUpd = await jsonApi('/api/ai/token-deals/' + dealA, tokA, 'PUT', {})
  check('不带任何字段 → 400', emptyUpd.status === 400, 'status=' + emptyUpd.status)

  const badUpd = await jsonApi('/api/ai/token-deals/' + dealA, tokA, 'PUT', { region: 'mars' })
  check('更新为非法 region → 400', badUpd.status === 400, 'status=' + badUpd.status)

  const emptyTitle = await jsonApi('/api/ai/token-deals/' + dealA, tokA, 'PUT', { title: '   ' })
  check('更新为空标题 → 400', emptyTitle.status === 400, 'status=' + emptyTitle.status)

  const crossUpd = await jsonApi('/api/ai/token-deals/' + dealA, tokB, 'PUT', { title: '越权改名' })
  check('B 更新 A 的通告 → 404（不区分无权限与不存在）', crossUpd.status === 404, 'status=' + crossUpd.status)

  const ghostUpd = await jsonApi('/api/ai/token-deals/deal_not_exist_' + RUN, adminTok, 'PUT', { title: 'x' })
  check('更新不存在的通告 → 404', ghostUpd.status === 404, 'status=' + ghostUpd.status)

  // 管理员更新待审核通告：保持原状态（不因管理员编辑而改变）
  const adminUpd = await jsonApi('/api/ai/token-deals/' + dealA, adminTok, 'PUT', { quota: '每日 2000 次' })
  check('管理员更新他人通告 → 200', adminUpd.status === 200, 'status=' + adminUpd.status)
  check('管理员编辑保持原状态（pending）', adminUpd.json?.status === 'pending', 'status=' + adminUpd.json?.status)
  check('quota 已更新', adminUpd.json?.token_deal?.quota === '每日 2000 次', 'quota=' + adminUpd.json?.token_deal?.quota)

  const noConfirm = await jsonApi('/api/ai/token-deals/' + dealA, adminTok, 'DELETE', {})
  check('删除通告缺 confirm → 400', noConfirm.status === 400, 'status=' + noConfirm.status)

  const noScope = await jsonApi('/api/ai/token-deals/' + dealA, tokA, 'DELETE', { confirm: true })
  check('write 令牌删除通告 → 403', noScope.status === 403, 'status=' + noScope.status)

  const crossDel = await jsonApi('/api/ai/token-deals/' + dealA, tokB, 'DELETE', { confirm: true })
  check('B（无 delete scope）删除 A 的通告 → 403', crossDel.status === 403, 'status=' + crossDel.status)

  const adminDelOther = await jsonApi('/api/ai/token-deals/' + dealA, adminTok, 'DELETE', { confirm: true })
  check('管理员删除他人通告 → 200（与 Web 语义一致）', adminDelOther.status === 200 && adminDelOther.json?.success === true, 'status=' + adminDelOther.status + ' ' + JSON.stringify(adminDelOther.json))

  const selfDel = await jsonApi('/api/ai/token-deals/' + adminDealId, adminTok, 'DELETE', { confirm: true })
  check('管理员删除自己的通告 → 200', selfDel.status === 200, 'status=' + selfDel.status)

  const ghostDel = await jsonApi('/api/ai/token-deals/deal_not_exist_' + RUN, adminTok, 'DELETE', { confirm: true })
  check('删除不存在的通告 → 404', ghostDel.status === 404, 'status=' + ghostDel.status)
}

// ─── 6. 限频 ────────────────────────────────────────────────────
console.log('=== 6. 限频（专用 IP，需 NUXT_TRUST_PROXY=true） ===')
{
  const MAX = 400
  let successes = 0
  let first429At = null
  let body429 = null
  for (let i = 0; i < MAX; i++) {
    const r = await api('/api/ai/stats', tokA, { headers: { 'x-forwarded-for': BURST_IP } })
    if (r.status === 429) { first429At = i + 1; body429 = r.json; break }
    if (r.status === 200) successes++
    else { warn(`压测第 ${i + 1} 次出现非 200/429 状态: ${r.status}`); break }
  }
  check('限频触发 429（IP 级 300 次/分钟）', first429At !== null, '未在 ' + MAX + ' 次内触发')
  check('429 前成功次数在 200–305 之间', successes >= 200 && successes <= 305, 'successes=' + successes)
  check('429 响应体含 error 文案', !!body429?.error, JSON.stringify(body429))
  console.log(`  [INFO] 第 ${first429At ?? '—'} 次请求触发 429，此前成功 ${successes} 次`)
}

// ─── 7. 审计 ────────────────────────────────────────────────────
console.log('=== 7. 审计日志 ===')
{
  const db = await openDb()
  if (!db) {
    warn('跳过审计断言（未提供 dbPath）')
  } else {
    const cnt = (sql, ...p) => db.prepare(sql).get(...p).c
    check('审计记录 400（参数非法）', cnt('SELECT COUNT(*) AS c FROM ai_audit_logs WHERE status_code = 400') > 0)
    check('审计记录 404（越权/不存在）', cnt('SELECT COUNT(*) AS c FROM ai_audit_logs WHERE status_code = 404') > 0)
    check('审计记录 409（唯一约束）', cnt('SELECT COUNT(*) AS c FROM ai_audit_logs WHERE status_code = 409') > 0)
    // 注：限频在 authenticateAi 内抛出，位于 defineAiHandler 的 try/finally 之外，
    // 因此 429 不计入审计 —— 这是有意设计（未通过鉴权的请求不产生审计噪音）。
    const s429 = cnt('SELECT COUNT(*) AS c FROM ai_audit_logs WHERE status_code = 429')
    console.log(`  [INFO] 429 审计记录数 = ${s429}（限频在鉴权阶段拦截，预期为 0）`)
    check('审计覆盖书签写入路径', cnt("SELECT COUNT(*) AS c FROM ai_audit_logs WHERE path = '/api/ai/bookmarks' AND method = 'POST'") > 0)
    check('审计覆盖删除路径', cnt("SELECT COUNT(*) AS c FROM ai_audit_logs WHERE method = 'DELETE'") > 0)

    const flat = JSON.stringify(db.prepare('SELECT * FROM ai_audit_logs').all())
    check('审计日志不含请求体敏感内容（关键）', !flat.includes(SENSITIVE_MARKER), 'marker=' + SENSITIVE_MARKER)
    check('审计日志不含明文令牌', !/favs_ai_[A-Za-z0-9_-]{20,}/.test(flat), '')

    const linked = cnt('SELECT COUNT(*) AS c FROM ai_audit_logs l JOIN api_tokens t ON l.token_id = t.id') 
    check('审计 token_id 可关联到 api_tokens', linked > 0, 'linked=' + linked)

    const crossUser = db.prepare('SELECT COUNT(*) AS c FROM ai_audit_logs WHERE user_id = 0').get().c
    check('审计 user_id 均为真实用户（无 0）', crossUser === 0, 'count=' + crossUser)
  }
}

// ════════════════════════════════════════════════════════════════
console.log('')
console.log('========================================')
console.log('通过: ' + pass + '  失败: ' + fail)
if (failures.length) {
  console.log('失败项:')
  for (const f of failures) console.log('  - ' + f)
}
if (warnings.length) {
  console.log('警告:')
  for (const w of warnings) console.log('  - ' + w)
}
process.exit(fail > 0 ? 1 : 0)
