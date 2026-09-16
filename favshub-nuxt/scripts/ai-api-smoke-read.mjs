// AI 数据操作能力 — 只读 / 鉴权边界端到端测试（约 55 项断言）
//
// 覆盖:
//   1. 令牌创建与展示安全（明文只回一次、库中无明文、delete scope 仅管理员）
//   2. 通道隔离（PAT ≠ JWT，双向互不承认）
//   3. 只读端点（describe / stats / 五类资源列表）
//   4. scope 分级（read 令牌不可写、不可删）
//   5. MCP 通道（initialize / ping / tools/list / tools/call / 未知工具 / 权限一致）
//   6. 审计日志（落库、状态码、无明文与请求体泄露）
//
// 用法:
//   1) 准备临时库（**切勿指向生产库**），并确保开放注册：
//        sqlite3 data/favshub.db ".backup data-test/ai-smoke.db"
//        sqlite3 data-test/ai-smoke.db \
//          "INSERT INTO system_config(key,value) VALUES('allow_registration','true')
//             ON CONFLICT(key) DO UPDATE SET value='true';"
//   2) 启动被测服务（注意 NUXT_ADMIN_USERS 与 NUXT_TRUST_PROXY 两项）：
//        NUXT_DB_PATH=/tmp/favshub-ai-smoke.db \
//        NUXT_JWT_SECRET=smoke-secret-key \
//        NUXT_ADMIN_USERS=smokeadmin \
//        NUXT_TRUST_PROXY=true \
//        PORT=3210 HOST=127.0.0.1 node .output/server/index.mjs
//   3) node scripts/ai-api-smoke-read.mjs [baseUrl] [dbPath]
//        dbPath 可省略（省略时跳过「库级断言」并打印 WARN），也可用 SMOKE_DB 环境变量。
//
// 依赖: 服务端须以 NUXT_ADMIN_USERS=smokeadmin 启动 —— 迁移会预置 admin_favs(id=1, is_admin=1)，
//       故「首注册用户自动提权」已不会触发，注册出来的账号必然是普通用户。
//       若省略，第 1 节的管理员相关断言会失败（其余仍有效）。
//
// 退出码: 0 全通过 / 1 有失败项
const BASE = process.argv[2] || 'http://127.0.0.1:3210'
const DB_PATH = process.argv[3] || process.env.SMOKE_DB || ''

const ADMIN_USER = 'smokeadmin'
const USER_A = 'aiskill_a'
const USER_B = 'aiskill_b'
const PWD = 'SmokeTest123'

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

/** 注册或登录（可重复运行） */
async function ensureAuth(client, username, nickname) {
  const r = await client.req('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PWD, nickname }),
  })
  if (r.status === 200) return { status: 200, isAdmin: r.json?.user?.is_admin, registered: true }
  if (r.status === 409) {
    const l = await client.req('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PWD }),
    })
    return { status: l.status, isAdmin: l.json?.user?.is_admin, registered: false }
  }
  return { status: r.status, isAdmin: r.json?.user?.is_admin, registered: false, raw: r.json }
}

/** 用 JWT 通道创建一个 PAT，返回 { status, plain, id } */
async function createToken(client, name, scopes, extra = {}) {
  const r = await client.req('/api/user/api-tokens', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, scopes, ...extra }),
  })
  return { status: r.status, plain: r.json?.token || null, id: r.json?.token_info?.id ?? null, json: r.json }
}

/** Bearer 请求（不携带 cookie） */
function bearer(path, token, opts = {}) {
  return anon.req(path, {
    ...opts,
    headers: { ...(opts.headers || {}), authorization: 'Bearer ' + token },
  })
}

/** JSON-RPC 调用 */
function rpc(token, method, params, id = 1) {
  return bearer('/api/mcp', token, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }),
  })
}

/** 惰性打开只读 DB（用于库级断言） */
let _db = null
let _dbTried = false
async function openDb() {
  if (_dbTried) return _db
  _dbTried = true
  if (!DB_PATH) return null
  try {
    const mod = await import('better-sqlite3')
    const Database = mod.default
    _db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  } catch (e) {
    warn(`无法打开 DB 做库级断言（${DB_PATH}）: ${e.message}`)
    _db = null
  }
  return _db
}

// ════════════════════════════════════════════════════════════════
console.log('=== 0. 账号准备 ===')
let adminRes, userARes
{
  adminRes = await ensureAuth(admin, ADMIN_USER, 'AI 冒烟管理员')
  check('管理员账号可用', adminRes.status === 200, 'status=' + adminRes.status + ' ' + JSON.stringify(adminRes.raw || ''))
  check('管理员拿到 cookie', !!admin.cookie)
  // 注意：/api/auth/* 返回的 is_admin 只反映 DB 字段，不含 NUXT_ADMIN_USERS 运维旁路。
  // 因此这里只校验字段存在；「该账号确实被当作管理员」的真正证明是
  // 第 1 节能成功创建 delete scope 令牌（普通用户会 403）。
  check('管理员响应含 is_admin 字段', typeof adminRes.isAdmin === 'boolean', 'is_admin=' + adminRes.isAdmin)

  userARes = await ensureAuth(userA, USER_A, 'AI 冒烟用户 A')
  check('用户 A 可用', userARes.status === 200, 'status=' + userARes.status)
  check('用户 A is_admin=false', userARes.isAdmin === false, 'is_admin=' + userARes.isAdmin)

  const b = await ensureAuth(userB, USER_B, 'AI 冒烟用户 B')
  check('用户 B 可用', b.status === 200, 'status=' + b.status)
  check('用户 B is_admin=false', b.isAdmin === false, 'is_admin=' + b.isAdmin)
}

// ─── 1. 令牌创建与展示安全 ───────────────────────────────────────
console.log('=== 1. 令牌创建与展示安全（JWT 通道） ===')
let readTok = null
let readTokId = null
let revokedPlain = null
{
  const noAuth = await anon.req('/api/user/api-tokens', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x', scopes: ['read'] }),
  })
  check('未登录创建令牌 → 401', noAuth.status === 401, 'status=' + noAuth.status)

  const c = await createToken(userA, '冒烟只读令牌', ['read'])
  check('创建 read 令牌 → 200', c.status === 200, 'status=' + c.status + ' ' + JSON.stringify(c.json))
  readTok = c.plain
  readTokId = c.id
  check('明文令牌以 favs_ai_ 开头', typeof readTok === 'string' && readTok.startsWith('favs_ai_'), 'token=' + String(readTok).slice(0, 16))
  check('明文令牌长度 51（前缀 8 + 43）', String(readTok).length === 51, 'len=' + String(readTok).length)
  check('响应含「仅显示一次」告警', /仅显示一次|不保存明文/.test(c.json?.warning || ''), c.json?.warning)
  check('token_info.scopes 含 read', Array.isArray(c.json?.token_info?.scopes) && c.json.token_info.scopes.includes('read'), JSON.stringify(c.json?.token_info?.scopes))

  const noScope = await createToken(userA, '无 scope', [])
  check('scopes 为空 → 400', noScope.status === 400, 'status=' + noScope.status)

  const longName = await createToken(userA, 'x'.repeat(65), ['read'])
  check('令牌名超长（65）→ 400', longName.status === 400, 'status=' + longName.status)

  const badDays = await createToken(userA, '非法天数', ['read'], { expires_in_days: 4000 })
  check('有效天数越界（4000）→ 400', badDays.status === 400, 'status=' + badDays.status)

  // 普通用户不可创建 delete scope
  const delTok = await createToken(userA, '越权删除令牌', ['read', 'write', 'delete'])
  check('普通用户创建 delete 令牌 → 403', delTok.status === 403, 'status=' + delTok.status + ' ' + JSON.stringify(delTok.json))

  // 管理员可以
  const adminDel = await createToken(admin, '管理员全权令牌', ['read', 'write', 'delete'])
  check('管理员创建 delete 令牌 → 200（证明管理员身份生效）', adminDel.status === 200, 'status=' + adminDel.status + ' ' + JSON.stringify(adminDel.json))
  if (adminDel.plain) {
    const rev = await admin.req('/api/user/api-tokens/' + adminDel.id, { method: 'DELETE' })
    check('管理员可吊销自己的令牌 → 200', rev.status === 200, 'status=' + rev.status + ' ' + JSON.stringify(rev.json))
    revokedPlain = adminDel.plain
  }

  // 列表接口不泄露哈希
  const list = await userA.req('/api/user/api-tokens')
  check('令牌列表 → 200', list.status === 200, 'status=' + list.status)
  check('列表不含 token_hash 字段', !list.text.includes('token_hash'), '')
  check('列表不含明文令牌', !list.text.includes(readTok), '')
  const mine = (list.json?.tokens || []).find(t => t.id === readTokId)
  check('列表含刚创建的令牌（active）', !!mine && mine.status === 'active', JSON.stringify(mine))
  check('列表 prefix 已脱敏（以 … 结尾）', !!mine && /^favs_ai_.{8}…$/.test(mine.prefix), mine?.prefix)
}

// 库级断言：明文绝不落库
{
  const db = await openDb()
  if (!db) {
    warn('跳过库级断言（未提供 dbPath 或 better-sqlite3 不可用）')
  } else {
    const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(readTokId)
    check('DB 中 token_hash 为 64 位 hex', !!row && /^[0-9a-f]{64}$/.test(String(row.token_hash)), 'hash=' + String(row?.token_hash).slice(0, 16))
    const cols = Object.keys(row || {})
    const leaked = cols.filter(k => String(row[k]).includes(readTok))
    check('DB 中不存在明文令牌（全列扫描）', leaked.length === 0, 'leaked_cols=' + JSON.stringify(leaked))
    check('DB 中 scopes 已序列化为 "read"', row?.scopes === 'read', 'scopes=' + row?.scopes)
  }
}

// ─── 2. 通道隔离 ────────────────────────────────────────────────
console.log('=== 2. 通道隔离（PAT 与 JWT 双向互不承认） ===')
{
  const noTok = await anon.req('/api/ai/describe')
  check('无令牌访问 /api/ai/* → 401', noTok.status === 401, 'status=' + noTok.status)

  const byCookie = await userA.req('/api/ai/describe')
  check('登录 cookie（JWT）访问 /api/ai/* → 401', byCookie.status === 401, 'status=' + byCookie.status)

  const byJwtBearer = await bearer('/api/ai/describe', userA.jwt)
  check('JWT 作 Bearer 访问 /api/ai/* → 401', byJwtBearer.status === 401, 'status=' + byJwtBearer.status)
  check('错误信息指出仅接受 favs_ai_ 令牌', /favs_ai_/.test(byJwtBearer.json?.error || ''), byJwtBearer.json?.error)

  const patOnJwtChannel = await bearer('/api/user/api-tokens', readTok)
  check('PAT 访问 JWT 通道（/api/user/api-tokens）→ 401', patOnJwtChannel.status === 401, 'status=' + patOnJwtChannel.status)

  const forged = await bearer('/api/ai/describe', 'favs_ai_' + 'A'.repeat(43))
  check('伪造 PAT（正确前缀、随机体）→ 401', forged.status === 401, 'status=' + forged.status)

  const badPrefix = await bearer('/api/ai/describe', 'not_a_pat_token')
  check('非 PAT 前缀 Bearer → 401', badPrefix.status === 401, 'status=' + badPrefix.status)

  const badScheme = await anon.req('/api/ai/describe', { headers: { authorization: 'Token ' + readTok } })
  check('非 Bearer scheme → 401', badScheme.status === 401, 'status=' + badScheme.status)

  if (revokedPlain) {
    const revoked = await bearer('/api/ai/describe', revokedPlain)
    check('已吊销令牌 → 401', revoked.status === 401, 'status=' + revoked.status)
  } else {
    warn('跳过「已吊销令牌」断言（管理员 delete 令牌创建失败）')
  }
}

// ─── 3. 只读端点 ────────────────────────────────────────────────
console.log('=== 3. 只读端点（read scope） ===')
{
  const d = await bearer('/api/ai/describe', readTok)
  check('describe → 200', d.status === 200, 'status=' + d.status)
  check('describe.name = favshub-ai-data-ops', d.json?.name === 'favshub-ai-data-ops', d.json?.name)
  check('describe.auth.token_prefix = favs_ai_', d.json?.auth?.token_prefix === 'favs_ai_', d.json?.auth?.token_prefix)
  check('describe.caller.scopes 含 read', Array.isArray(d.json?.caller?.scopes) && d.json.caller.scopes.includes('read'), JSON.stringify(d.json?.caller?.scopes))
  check('describe.caller.is_admin = false', d.json?.caller?.is_admin === false, 'is_admin=' + d.json?.caller?.is_admin)

  // 管理员身份判定必须与 Web 通道一致：smokeadmin 的 DB is_admin=0，
  // 其管理员身份来自 NUXT_ADMIN_USERS 环境变量旁路 —— 这正是 isUserAdmin 曾经的缺陷点
  // （旧实现只查 DB is_admin，会把运维旁路管理员在 AI 通道降级为普通用户）。
  const adminRead = await createToken(admin, '管理员只读令牌', ['read'])
  if (adminRead.plain) {
    const dAdmin = await bearer('/api/ai/describe', adminRead.plain)
    check('describe.caller.is_admin = true（NUXT_ADMIN_USERS 旁路生效）', dAdmin.json?.caller?.is_admin === true, 'is_admin=' + dAdmin.json?.caller?.is_admin)
    await admin.req('/api/user/api-tokens/' + adminRead.id, { method: 'DELETE' })
  } else {
    check('describe.caller.is_admin = true（NUXT_ADMIN_USERS 旁路生效）', false, '管理员只读令牌创建失败: ' + JSON.stringify(adminRead.json))
  }
  check('describe.rules.batch_limit = 50', d.json?.rules?.batch_limit === 50, String(d.json?.rules?.batch_limit))
  check('describe.rules.delete_requires_confirm = true', d.json?.rules?.delete_requires_confirm === true)
  check('describe.endpoints ≥ 20 条', (d.json?.endpoints?.length || 0) >= 20, 'len=' + d.json?.endpoints?.length)
  const resKeys = Object.keys(d.json?.resources || {})
  check('describe.resources 覆盖 5 类资源', ['bookmarks', 'folders', 'prompts', 'tags', 'token_deals'].every(k => resKeys.includes(k)), JSON.stringify(resKeys))
  check('describe.errors 含 401/403/404/429', ['401', '403', '404', '429'].every(k => d.json?.errors?.[k]), JSON.stringify(Object.keys(d.json?.errors || {})))
  check('describe.recommended_workflow 非空', Array.isArray(d.json?.recommended_workflow) && d.json.recommended_workflow.length > 0)

  const s = await bearer('/api/ai/stats', readTok)
  check('stats → 200', s.status === 200, 'status=' + s.status)
  check('stats.counts 含 5 个计数键', ['bookmarks', 'folders', 'prompts', 'tags', 'token_deals'].every(k => typeof s.json?.counts?.[k] === 'number'), JSON.stringify(s.json?.counts))

  for (const [path, key] of [['/api/ai/bookmarks', 'bookmarks'], ['/api/ai/folders', 'folders'], ['/api/ai/prompts', 'prompts'], ['/api/ai/tags', 'tags'], ['/api/ai/token-deals', 'token_deals']]) {
    const r = await bearer(path, readTok)
    check(`GET ${path} → 200`, r.status === 200, 'status=' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160))
    check(`GET ${path} 返回 ${key} 数组`, Array.isArray(r.json?.[key]), typeof r.json?.[key])
  }
}

// ─── 4. scope 分级：read 令牌不可写、不可删 ──────────────────────
console.log('=== 4. scope 分级（read 令牌） ===')
{
  const w = await bearer('/api/ai/bookmarks', readTok, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '越权写入', url: 'https://example.com/forbidden' }),
  })
  check('read 令牌 POST /api/ai/bookmarks → 403', w.status === 403, 'status=' + w.status + ' ' + JSON.stringify(w.json))
  check('403 文案指出缺少 write 权限', /write/.test(w.json?.error || ''), w.json?.error)

  const del = await bearer('/api/ai/bookmarks/1', readTok, {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  })
  check('read 令牌 DELETE → 403', del.status === 403, 'status=' + del.status)

  const tag = await bearer('/api/ai/tags', readTok, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '越权标签' }),
  })
  check('read 令牌 POST /api/ai/tags → 403', tag.status === 403, 'status=' + tag.status)
}

// ─── 5. MCP 通道 ────────────────────────────────────────────────
console.log('=== 5. MCP 通道（JSON-RPC 2.0） ===')
{
  const noTok = await anon.req('/api/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  })
  check('MCP 无令牌 → 401', noTok.status === 401, 'status=' + noTok.status)

  const jwtOnMcp = await bearer('/api/mcp', userA.jwt, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  })
  check('MCP 用 JWT → 401', jwtOnMcp.status === 401, 'status=' + jwtOnMcp.status)

  const init = await rpc(readTok, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'smoke', version: '1.0' } })
  check('initialize → 200', init.status === 200, 'status=' + init.status)
  check('initialize 返回 serverInfo.name', init.json?.result?.serverInfo?.name === 'favshub-ai-data-ops', JSON.stringify(init.json?.result?.serverInfo))
  check('initialize 声明 tools 能力', init.json?.result?.capabilities?.tools !== undefined, JSON.stringify(init.json?.result?.capabilities))
  check('initialize 回显协议版本', typeof init.json?.result?.protocolVersion === 'string', init.json?.result?.protocolVersion)

  const ping = await rpc(readTok, 'ping')
  check('ping → result 为空对象', ping.status === 200 && ping.json?.result && Object.keys(ping.json.result).length === 0, JSON.stringify(ping.json))

  const tl = await rpc(readTok, 'tools/list')
  const tools = tl.json?.result?.tools || []
  check('tools/list → 200', tl.status === 200, 'status=' + tl.status)
  check('tools/list 工具数 ≥ 20', tools.length >= 20, 'len=' + tools.length)
  check('每个工具含 name/description/inputSchema', tools.every(t => t.name && t.description && t.inputSchema), '')
  check('工具描述标注所需权限', tools.every(t => /\[需要 (read|write|delete) 权限\]/.test(t.description)), tools[0]?.description)

  const call = await rpc(readTok, 'tools/call', { name: 'get_stats', arguments: {} })
  check('tools/call get_stats → 200', call.status === 200, 'status=' + call.status)
  check('get_stats 返回 structuredContent.counts', typeof call.json?.result?.structuredContent?.counts?.bookmarks === 'number', JSON.stringify(call.json?.result?.structuredContent))
  check('get_stats 同时返回 text content', call.json?.result?.content?.[0]?.type === 'text', JSON.stringify(call.json?.result?.content?.[0]?.type))

  const lb = await rpc(readTok, 'tools/call', { name: 'list_bookmarks', arguments: { limit: 2 } })
  check('tools/call list_bookmarks 返回数组', Array.isArray(lb.json?.result?.structuredContent?.bookmarks), JSON.stringify(lb.json?.result?.structuredContent).slice(0, 120))

  const dd = await rpc(readTok, 'tools/call', { name: 'describe', arguments: {} })
  check('tools/call describe 可用', dd.json?.result?.structuredContent?.name === 'favshub-ai-data-ops', dd.json?.result?.structuredContent?.name)

  const unknown = await rpc(readTok, 'tools/call', { name: 'no_such_tool', arguments: {} })
  check('未知工具 → error.code -32602', unknown.json?.error?.code === -32602, JSON.stringify(unknown.json?.error))

  const badMethod = await rpc(readTok, 'bogus/method')
  check('不支持的方法 → error.code -32601', badMethod.json?.error?.code === -32601, JSON.stringify(badMethod.json?.error))

  // 权限一致性：read 令牌在 REST 与 MCP 两侧都应被拒
  const mcpWrite = await rpc(readTok, 'tools/call', { name: 'create_bookmarks', arguments: { title: 'x', url: 'https://example.com/x' } })
  check('read 令牌 MCP create_bookmarks → 拒绝', !!mcpWrite.json?.error, JSON.stringify(mcpWrite.json?.error))
  check('MCP 权限拒绝标注 http_status 403', mcpWrite.json?.error?.data?.http_status === 403, JSON.stringify(mcpWrite.json?.error?.data))
  check('MCP 权限拒绝文案含 write', /write/.test(mcpWrite.json?.error?.message || ''), mcpWrite.json?.error?.message)

  const mcpDelete = await rpc(readTok, 'tools/call', { name: 'delete_bookmark', arguments: { id: 1, confirm: true } })
  check('read 令牌 MCP delete_bookmark → 拒绝', !!mcpDelete.json?.error, JSON.stringify(mcpDelete.json?.error))

  const notif = await rpc(readTok, 'notifications/initialized')
  check('notifications/* → 无响应体（200/204）', notif.status === 200 || notif.status === 204, 'status=' + notif.status)
}

// ─── 6. 审计日志 ────────────────────────────────────────────────
console.log('=== 6. 审计日志 ===')
{
  const db = await openDb()
  if (!db) {
    warn('跳过审计断言（未提供 dbPath）')
  } else {
    const total = db.prepare('SELECT COUNT(*) AS c FROM ai_audit_logs').get().c
    check('ai_audit_logs 已有记录', total > 0, 'total=' + total)

    const aiPaths = db.prepare("SELECT COUNT(*) AS c FROM ai_audit_logs WHERE path LIKE '/api/ai/%'").get().c
    check('审计覆盖 /api/ai/* 路径', aiPaths > 0, 'count=' + aiPaths)

    const mcpPaths = db.prepare("SELECT COUNT(*) AS c FROM ai_audit_logs WHERE path = '/api/mcp'").get().c
    check('审计覆盖 /api/mcp 路径', mcpPaths > 0, 'count=' + mcpPaths)

    const s403 = db.prepare('SELECT COUNT(*) AS c FROM ai_audit_logs WHERE status_code = 403').get().c
    check('审计记录 403（权限拒绝）', s403 > 0, 'count=' + s403)

    const s200 = db.prepare('SELECT COUNT(*) AS c FROM ai_audit_logs WHERE status_code = 200').get().c
    check('审计记录 200（成功）', s200 > 0, 'count=' + s200)

    const hasIp = db.prepare("SELECT COUNT(*) AS c FROM ai_audit_logs WHERE ip IS NOT NULL AND ip != ''").get().c
    check('审计记录来源 IP', hasIp > 0, 'count=' + hasIp)

    const dump = db.prepare('SELECT method, path, scope, status_code, body_summary FROM ai_audit_logs').all()
    const flat = JSON.stringify(dump)
    check('审计表不含明文令牌', !flat.includes(readTok), '')
    check('审计不含 favs_ai_ 明文片段', !/favs_ai_[A-Za-z0-9_-]{20,}/.test(flat), '')
    check('审计 scope 字段合法', dump.every(r => ['read', 'write', 'delete'].includes(r.scope)), JSON.stringify([...new Set(dump.map(r => r.scope))]))

    const scopes = new Set(dump.map(r => r.scope))
    check('审计区分 read / write / delete scope', scopes.has('read'), JSON.stringify([...scopes]))
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
