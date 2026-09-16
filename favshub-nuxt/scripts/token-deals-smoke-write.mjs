// Token 白嫖通告 — 写入/审核流程端到端测试（51 项断言）
//
// 覆盖: 注册/登录 → 发布进待审核 → 待审核可见性 → 管理员审核 →
//       一人一票(取消/改票) → 一人一评(更新/越界) → 置顶 → 驳回 → 删除鉴权
//
// 用法:
//   1) 启动被测服务（务必用库副本，勿指向生产库）:
//      NUXT_DB_PATH="<临时库路径>" NUXT_JWT_SECRET="smoke-secret-key" \
//        PORT=3210 HOST=127.0.0.1 node .output/server/index.mjs
//   2) node scripts/token-deals-smoke-write.mjs [baseUrl]
//
// 幂等: 账号已存在时自动回退为登录，可重复运行。
// 管理员: 库中首个注册用户(id>1)自动 is_admin=1；或设 NUXT_ADMIN_USERS=<用户名>。
// 退出码: 0 全通过 / 1 有失败项
const BASE = process.argv[2] || 'http://127.0.0.1:3210'
const ADMIN_USER = 'smokeadmin'
const NORMAL_USER = 'smokeuser'
const PWD = 'SmokeTest123'

let pass = 0, fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  [PASS]', name) }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  [FAIL]', name, detail) }
}

function makeClient() {
  let cookie = ''
  return {
    get cookie() { return cookie },
    async req(path, opts = {}) {
      const headers = { ...(opts.headers || {}) }
      if (cookie) headers.cookie = cookie
      const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' })
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const sc of setCookies) {
        const kv = sc.split(';')[0]
        if (kv.startsWith('favshub_token=')) cookie = kv
      }
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* ignore */ }
      return { status: res.status, json, text }
    },
  }
}

const admin = makeClient()
const user = makeClient()
const other = makeClient()
const anon = makeClient()

// 注册或登录（使测试可重复运行：库中已存在该账号时回退登录）
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
  return { status: r.status, isAdmin: r.json?.user?.is_admin, registered: false }
}

console.log('=== 1. 注册/登录三个账号 ===')
{
  const a = await ensureAuth(admin, ADMIN_USER, '审核管理员')
  check('管理员账号可用', a.status === 200, 'status=' + a.status)
  check('管理员拿到 cookie', !!admin.cookie, 'cookie=' + admin.cookie.slice(0, 30))
  check('管理员 is_admin=true', a.isAdmin === true, 'is_admin=' + a.isAdmin)

  const b = await ensureAuth(user, NORMAL_USER, '普通用户')
  check('普通账号可用', b.status === 200, 'status=' + b.status)
  check('普通账号拿到 cookie', !!user.cookie)
  check('普通账号 is_admin=false', b.isAdmin === false, 'is_admin=' + b.isAdmin)

  // 第三个账号：用于验证「非作者非管理员」越权场景
  const c = await ensureAuth(other, 'smokeother', '无关用户')
  check('第三账号可用', c.status === 200, 'status=' + c.status)
  check('第三账号非管理员', c.isAdmin === false, 'is_admin=' + c.isAdmin)
}

console.log('=== 2. 普通用户发布 → 进入待审核 ===')
let pendingId = null
{
  const r = await user.req('/api/token-deals', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: '冒烟测试服务商', title: '冒烟测试通告标题', url: 'https://example.com/free',
      call_url: 'https://api.example.com/v1', quota: '每日 1000 次',
      models: ['test-model-a', 'test-model-b'], region: 'cn', quality: '中品',
      source_tag: 'community', note: '自动化测试写入',
    }),
  })
  check('发布成功 200', r.status === 200, 'status=' + r.status + ' ' + JSON.stringify(r.json))
  check('返回 status=pending', r.json?.status === 'pending', 'status=' + r.json?.status)
  check('返回提示等待审核', /审核/.test(r.json?.message || ''), r.json?.message)
  pendingId = r.json?.deal_id
  check('拿到 deal_id', !!pendingId, pendingId)
}

console.log('=== 3. 待审核内容不对外可见，但自己可见 ===')
{
  const pub = await anon.req('/api/token-deals?limit=100')
  const ids = pub.json.deals.map(d => d.id)
  check('公开列表不含待审核项', !ids.includes(pendingId), '公开 total=' + pub.json.pagination.total)

  const mine = await user.req('/api/token-deals?mine=1&limit=100')
  check('mine=1 含自己的待审核项', mine.json.deals.some(d => d.id === pendingId), 'mine total=' + mine.json.pagination.total)

  const mineAnon = await anon.req('/api/token-deals?mine=1')
  check('未登录访问 mine → 401', mineAnon.status === 401, 'status=' + mineAnon.status)

  const normalAdmin = await user.req('/api/admin/token-deals?status=pending')
  check('普通用户访问管理端 → 403', normalAdmin.status === 403, 'status=' + normalAdmin.status)
}

console.log('=== 4. 管理员审核 ===')
{
  const list = await admin.req('/api/admin/token-deals?status=pending&limit=50')
  check('管理端可见待审核项', list.json?.deals?.some(d => d.id === pendingId), 'counts=' + JSON.stringify(list.json?.counts))
  check('counts 含 pending', typeof list.json?.counts?.pending === 'number', JSON.stringify(list.json?.counts))

  const bad = await admin.req('/api/admin/token-deals/' + pendingId + '/review', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'bogus' }),
  })
  check('非法审核动作 → 400', bad.status === 400, 'status=' + bad.status)

  const ok = await admin.req('/api/admin/token-deals/' + pendingId + '/review', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  })
  check('审核通过 200', ok.status === 200 && ok.json?.status === 'approved', JSON.stringify(ok.json))

  const pub = await anon.req('/api/token-deals?limit=100')
  check('通过后公开列表可见', pub.json.deals.some(d => d.id === pendingId), '公开 total=' + pub.json.pagination.total)
}

console.log('=== 5. 投票（一人一票，可取消/改票） ===')
{
  const v1 = await user.req('/api/token-deals/' + pendingId + '/vote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vote: 'up' }),
  })
  check('投赞成票成功', v1.status === 200 && v1.json?.my_vote === 'up', JSON.stringify(v1.json))
  check('vote_up=1', v1.json?.vote_up === 1, 'vote_up=' + v1.json?.vote_up)

  const v2 = await user.req('/api/token-deals/' + pendingId + '/vote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vote: 'up' }),
  })
  check('重复投同向 = 取消', v2.json?.my_vote === null && v2.json?.vote_up === 0, JSON.stringify(v2.json))

  const v3 = await user.req('/api/token-deals/' + pendingId + '/vote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vote: 'down' }),
  })
  check('改投反对票', v3.json?.my_vote === 'down' && v3.json?.vote_down === 1, JSON.stringify(v3.json))

  const bad = await user.req('/api/token-deals/' + pendingId + '/vote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vote: 'sideways' }),
  })
  check('非法投票值 → 400', bad.status === 400, 'status=' + bad.status)
}

console.log('=== 6. 评测（一人一评，重复提交为更新） ===')
{
  const r1 = await user.req('/api/token-deals/' + pendingId + '/reviews', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating: 5, content: '自动化测试：首次评测' }),
  })
  check('提交评测成功', r1.status === 200 && r1.json?.rating_count === 1, JSON.stringify(r1.json))
  check('平均分 5', r1.json?.average === 5, 'average=' + r1.json?.average)

  const r2 = await user.req('/api/token-deals/' + pendingId + '/reviews', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating: 3, content: '自动化测试：更新评测' }),
  })
  check('重复提交为更新（计数不变）', r2.json?.rating_count === 1, 'count=' + r2.json?.rating_count)
  check('平均分更新为 3', r2.json?.average === 3, 'average=' + r2.json?.average)

  const bad = await user.req('/api/token-deals/' + pendingId + '/reviews', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating: 9, content: 'x' }),
  })
  check('评分越界 → 400', bad.status === 400, 'status=' + bad.status)

  const empty = await user.req('/api/token-deals/' + pendingId + '/reviews', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating: 4, content: '   ' }),
  })
  check('空内容 → 400', empty.status === 400, 'status=' + empty.status)

  const list = await anon.req('/api/token-deals/' + pendingId + '/reviews')
  check('评测列表含 1 条', list.json?.pagination?.total === 1, JSON.stringify(list.json?.pagination))
  check('星分布 rating3=1', list.json?.distribution?.['3'] === 1 || list.json?.distribution?.[3] === 1, JSON.stringify(list.json?.distribution))
  check('评测含作者名', list.json?.reviews?.[0]?.author === '普通用户', 'author=' + list.json?.reviews?.[0]?.author)
}

console.log('=== 7. 置顶（仅管理员） ===')
{
  const denied = await user.req('/api/token-deals/' + pendingId + '/pin', { method: 'POST' })
  check('普通用户置顶 → 403', denied.status === 403, 'status=' + denied.status)

  const p1 = await admin.req('/api/token-deals/' + pendingId + '/pin', { method: 'POST' })
  check('管理员置顶 → pinned=1', p1.status === 200 && p1.json?.pinned === 1, JSON.stringify(p1.json))

  const p2 = await admin.req('/api/token-deals/' + pendingId + '/pin', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pinned: false }),
  })
  check('显式取消置顶 → pinned=0', p2.json?.pinned === 0, JSON.stringify(p2.json))

  const p3 = await admin.req('/api/token-deals/' + pendingId + '/pin', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pinned: true }),
  })
  check('重新置顶', p3.json?.pinned === 1, JSON.stringify(p3.json))
}

console.log('=== 8. 驳回流程 ===')
let rejectedId = null
{
  const c = await user.req('/api/token-deals', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: '待驳回服务商', title: '待驳回通告', url: 'https://example.com/reject', region: 'global', quality: '下下品', source_tag: 'community' }),
  })
  rejectedId = c.json?.deal_id
  check('创建待驳回项', c.json?.status === 'pending', JSON.stringify(c.json))

  const rej = await admin.req('/api/admin/token-deals/' + rejectedId + '/review', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reject', reason: '信息不完整，请补充领取方式' }),
  })
  check('驳回成功', rej.status === 200 && rej.json?.status === 'rejected', JSON.stringify(rej.json))

  const pub = await anon.req('/api/token-deals?limit=100')
  check('驳回项不出现在公开列表', !pub.json.deals.some(d => d.id === rejectedId))

  // 设计约束：驳回项不对匿名者开放（不泄漏未通过内容）
  const anonDetail = await anon.req('/api/token-deals/' + rejectedId)
  check('匿名读驳回详情 → 403', anonDetail.status === 403, 'status=' + anonDetail.status)

  // 作者应能看到驳回原因
  const ownerDetail = await user.req('/api/token-deals/' + rejectedId)
  const reason = ownerDetail.json?.deal?.reject_reason
  check('作者可见详情', ownerDetail.status === 200, 'status=' + ownerDetail.status)
  check('详情含驳回原因', typeof reason === 'string' && reason.includes('信息不完整'), 'reason=' + reason)
  check('详情含 status=rejected', ownerDetail.json?.deal?.status === 'rejected', 'status=' + ownerDetail.json?.deal?.status)
  check('作者可编辑自己的驳回项', ownerDetail.json?.deal?.can_edit === true, 'can_edit=' + ownerDetail.json?.deal?.can_edit)
}

console.log('=== 9. 删除 ===')
{
  const anonDel = await anon.req('/api/token-deals/' + pendingId, { method: 'DELETE' })
  check('未登录删除 → 401', anonDel.status === 401, 'status=' + anonDel.status)

  const denied = await other.req('/api/token-deals/' + pendingId, { method: 'DELETE' })
  check('非作者非管理员删除 → 403', denied.status === 403, 'status=' + denied.status)

  const del = await admin.req('/api/token-deals/' + pendingId, { method: 'DELETE' })
  check('作者/管理员删除成功', del.status === 200, 'status=' + del.status + ' ' + JSON.stringify(del.json))

  const gone = await anon.req('/api/token-deals/' + pendingId)
  check('删除后详情 404', gone.status === 404, 'status=' + gone.status)

  await admin.req('/api/token-deals/' + rejectedId, { method: 'DELETE' })
}

console.log('')
console.log('========================================')
console.log('通过: ' + pass + '  失败: ' + fail)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log('  - ' + f) }
process.exit(fail > 0 ? 1 : 0)
