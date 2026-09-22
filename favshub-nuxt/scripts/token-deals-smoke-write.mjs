// Token 白嫖通告 — 写入/审核/修改建议流程端到端测试
//
// 覆盖: 注册/登录 → 发布进待审核 → 待审核可见性 → 管理员审核 →
//       一人一票(取消/改票) → 一人一评(更新/越界) → 置顶 → 驳回 → 删除鉴权 →
//       **修改建议**：任何人可对任意已公开通告提交字段级建议、同人覆盖、
//       可见性收窄、待我审核聚合、作者/管理员审核通过落库、驳回、撤回、越权 404
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
  // 注意：不能断言注册响应的 is_admin —— 注册只在「库中无管理员」时自动提权，
  // 而 NUXT_ADMIN_USERS 是在**请求时**生效的（见 getAuthRole）。
  // 因此改由后续「管理员审核/后台访问」等真实能力用例来证明管理员身份。

  const b = await ensureAuth(user, NORMAL_USER, '普通用户')
  check('普通账号可用', b.status === 200, 'status=' + b.status)
  check('普通账号拿到 cookie', !!user.cookie)
  check('普通账号 is_admin=false', b.isAdmin === false, 'is_admin=' + b.isAdmin)

  // 第三个账号：用于验证「非作者非管理员」越权场景
  const c = await ensureAuth(other, 'smokeother', '无关用户')
  check('第三账号可用', c.status === 200, 'status=' + c.status)
  check('第三账号非管理员', c.isAdmin === false, 'is_admin=' + c.isAdmin)

  // 用「访问管理端」直接证明管理员身份真实生效
  const adm = await admin.req('/api/admin/token-deals?status=pending')
  check('管理员可访问后台（身份生效）', adm.status === 200, 'status=' + adm.status)
  const den = await other.req('/api/admin/token-deals?status=pending')
  check('普通用户访问后台 → 403', den.status === 403, 'status=' + den.status)
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

// ══════════════════════════════════════════════════════════════
// 修改建议（提案）：通告内容允许所有人修改，但需作者或管理员审核
// ══════════════════════════════════════════════════════════════

console.log('=== 10. 提交修改建议 ===')
let dealId = null
let editId = null
{
  // 管理员建一条已通过的通告作为被改对象
  const c = await admin.req('/api/token-deals', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: '提案测试站', title: '原始标题', url: 'https://proposal.example.com',
      call_url: 'https://api.proposal.example.com/v1', quota: '100万 tokens',
      models: ['glm-4-flash'], region: 'cn', quality: '上品', source_tag: 'official',
      note: '原始备注',
    }),
  })
  dealId = c.json?.deal_id
  check('建立已通过的通告（管理员直接上线）', c.status === 200 && c.json?.status === 'approved', JSON.stringify(c.json))

  // 未登录不能提交
  const anonSub = await anon.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '匿名想改' }),
  })
  check('未登录提交建议 → 401', anonSub.status === 401, 'status=' + anonSub.status)

  // 无关用户可提交（这正是本功能的要点）
  const sub = await other.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '更正后的标题', quota: '500万 tokens', comment: '官网额度已更新' }),
  })
  check('无关用户可对他人通告提交建议', sub.status === 200, 'status=' + sub.status + ' ' + JSON.stringify(sub.json))
  editId = sub.json?.edit?.id
  check('返回提案 id', typeof editId === 'string' && editId.startsWith('edit_'), 'id=' + editId)
  check('首次提交 created=true', sub.json?.created === true)
  check('提案状态 pending', sub.json?.edit?.status === 'pending')
  check('提案人展示名正确', sub.json?.edit?.proposer === '无关用户', 'proposer=' + sub.json?.edit?.proposer)
  check('带 diff（2 项）', sub.json?.edit?.diff?.length === 2, JSON.stringify(sub.json?.edit?.diff))
  check('diff 带中文字段名', sub.json?.edit?.diff?.some(d => d.label === '通告标题'))

  // 主表未被改动
  const d1 = await anon.req('/api/token-deals/' + dealId)
  check('提案期间主表内容未变', d1.json?.deal?.title === '原始标题', 'title=' + d1.json?.deal?.title)
  check('提案期间额度未变', d1.json?.deal?.quota === '100万 tokens')

  // 无字段 / 无改动
  const empty = await other.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ comment: '只说句话' }),
  })
  check('无可改字段 → 400', empty.status === 400, 'status=' + empty.status)

  const noop = await other.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '原始标题' }),
  })
  check('与当前一致 → 400', noop.status === 400, 'status=' + noop.status)

  // 非法值
  const bad = await other.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'not-a-url' }),
  })
  check('非法 URL → 400', bad.status === 400, 'status=' + bad.status)

  // 不存在 / 越权字段
  const nf = await other.req('/api/token-deals/no_such_deal/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'x' }),
  })
  check('通告不存在 → 404', nf.status === 404, 'status=' + nf.status)

  // 白名单外的字段必须被剔除：status/pinned 不能通过建议通道夹带（应静默忽略，只留合法字段）
  const esc = await other.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '夹带尝试', status: 'rejected', pinned: 1, user_id: 1 }),
  })
  check('白名单外字段被剔除（只留 title）', esc.status === 200
    && Object.keys(esc.json?.edit?.payload || {}).join(',') === 'title',
    'payload=' + JSON.stringify(esc.json?.edit?.payload))

  // 完全不含合法字段时应拒绝
  const noField = await other.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'rejected', pinned: 1 }),
  })
  check('仅含权限字段 → 400（无有效字段）', noField.status === 400, 'status=' + noField.status)
}

console.log('=== 11. 再次提交覆盖 + 可见性 ===')
{
  const again = await other.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '第二次更正', note: '补充备注' }),
  })
  check('同人再次提交成功', again.status === 200, 'status=' + again.status)
  check('覆盖而非新建 created=false', again.json?.created === false)
  check('复用同一提案 id', again.json?.edit?.id === editId, 'id=' + again.json?.edit?.id)

  // 另一个用户也提一条 → 两条并存
  const sub2 = await user.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quality: '中品' }),
  })
  check('另一用户可同时提交', sub2.status === 200, 'status=' + sub2.status)

  // 可见性：无关用户只看自己的
  const asOther = await other.req('/api/token-deals/' + dealId + '/edits')
  check('提交人只看到自己的建议', asOther.json?.edits?.length === 1, 'len=' + asOther.json?.edits?.length)
  check('提交人 can_review=false', asOther.json?.can_review === false)

  // 详情摘要
  const detail = await other.req('/api/token-deals/' + dealId)
  check('详情含 edits 摘要', !!detail.json?.edits, JSON.stringify(detail.json?.edits)?.slice(0, 80))
  check('摘要含 my_edit', detail.json?.edits?.my_edit?.id === editId)
  check('摘要 pending_edit_count=2', detail.json?.edits?.pending_edit_count === 2, 'n=' + detail.json?.edits?.pending_edit_count)
  check('摘要 is_author=false（非作者）', detail.json?.edits?.is_author === false)

  const asAdmin = await admin.req('/api/token-deals/' + dealId)
  check('管理员 can_review=true', asAdmin.json?.edits?.can_review === true)
  check('管理员 is_author=true（本人发布）', asAdmin.json?.edits?.is_author === true)
}

console.log('=== 12. 待我审核 ===')
{
  const anonRv = await anon.req('/api/token-deal-edits')
  check('未登录待审列表 → 401', anonRv.status === 401, 'status=' + anonRv.status)

  const asOther = await other.req('/api/token-deal-edits')
  check('无关用户无待审项', (asOther.json?.total ?? 0) === 0, 'total=' + asOther.json?.total)

  const asAdmin = await admin.req('/api/token-deal-edits')
  check('管理员看到待审建议', (asAdmin.json?.total ?? 0) >= 2, 'total=' + asAdmin.json?.total)
  check('管理员 scope=all', asAdmin.json?.scope === 'all')
  check('列表项带 diff', Array.isArray(asAdmin.json?.edits?.[0]?.diff))
  check('列表项带所属通告摘要', !!asAdmin.json?.edits?.[0]?.deal?.id)
}

console.log('=== 13. 审核（通过 / 驳回 / 越权） ===')
{
  // 越权：提交人自己不能审
  const selfRev = await other.req('/api/token-deal-edits/' + editId + '/review', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  })
  check('提交人自己审核 → 404', selfRev.status === 404, 'status=' + selfRev.status)

  // 非法动作
  const badAct = await admin.req('/api/token-deal-edits/' + editId + '/review', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'maybe' }),
  })
  check('非法审核动作 → 400', badAct.status === 400, 'status=' + badAct.status)

  // 管理员通过（管理员可审所有用户的建议）
  const ok = await admin.req('/api/token-deal-edits/' + editId + '/review', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  })
  check('管理员通过建议', ok.status === 200, 'status=' + ok.status + ' ' + JSON.stringify(ok.json))
  check('返回提案已 approved', ok.json?.edit?.status === 'approved', JSON.stringify(ok.json?.edit?.status))

  const d = await anon.req('/api/token-deals/' + dealId)
  check('标题已落库', d.json?.deal?.title === '第二次更正', 'title=' + d.json?.deal?.title)
  check('备注已落库', d.json?.deal?.note === '补充备注', 'note=' + d.json?.deal?.note)
  check('未改字段保留 provider', d.json?.deal?.provider === '提案测试站', 'provider=' + d.json?.deal?.provider)
  check('未改字段保留 call_url', d.json?.deal?.call_url === 'https://api.proposal.example.com/v1')
  check('未改字段保留 region', d.json?.deal?.region === 'cn')

  // 重复审核
  const again = await admin.req('/api/token-deal-edits/' + editId + '/review', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  })
  check('重复审核 → 409', again.status === 409, 'status=' + again.status)

  // 驳回另一条（user 提的那条 quality=中品）
  const list = await admin.req('/api/token-deal-edits?limit=50')
  const target = list.json?.edits?.find(e => e.deal_id === dealId)
  check('待审列表还有另一条', !!target, JSON.stringify(list.json?.edits?.map(e => e.id)))
  if (target) {
    const rej = await admin.req('/api/token-deal-edits/' + target.id + '/review', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reject', reason: '品质分级调整需附实测依据' }),
    })
    check('驳回成功', rej.status === 200 && rej.json?.edit?.status === 'rejected', JSON.stringify(rej.json))
    check('驳回理由已记录', (rej.json?.edit?.reject_reason || '').includes('实测依据'), 'reason=' + rej.json?.edit?.reject_reason)

    const d2 = await anon.req('/api/token-deals/' + dealId)
    check('驳回后主表 quality 未变', d2.json?.deal?.quality === '上品', 'quality=' + d2.json?.deal?.quality)
  }

  // 作者身份审核：无关用户给另一条提，由作者(admin) 审 —— 已覆盖。
  // 再验一条：普通用户作为作者审自己通告上的建议
  const c = await user.req('/api/token-deals', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: '作者审核站', title: '作者的通告', url: 'https://owner.example.com',
      models: [], region: 'cn', quality: '中品', source_tag: 'official',
    }),
  })
  const ownDealId = c.json?.deal_id
  check('普通用户发布进入待审', c.json?.status === 'pending', JSON.stringify(c.json))

  // 待审通告他人不可见 → 提交建议应 404
  const onPending = await other.req('/api/token-deals/' + ownDealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '想改待审通告' }),
  })
  check('未过审通告他人提交建议 → 404', onPending.status === 404, 'status=' + onPending.status)

  await user.req('/api/token-deals/' + ownDealId, { method: 'DELETE' })
}

console.log('=== 14. 撤回建议 ===')
{
  const sub = await other.req('/api/token-deals/' + dealId + '/edits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: '这条会被撤回' }),
  })
  const wid = sub.json?.edit?.id
  check('提交待撤回的建议', typeof wid === 'string', 'id=' + wid)

  const anonWd = await anon.req('/api/token-deal-edits/' + wid, { method: 'DELETE' })
  check('未登录撤回 → 401', anonWd.status === 401, 'status=' + anonWd.status)

  const foreign = await user.req('/api/token-deal-edits/' + wid, { method: 'DELETE' })
  check('他人撤回 → 404', foreign.status === 404, 'status=' + foreign.status)

  const own = await other.req('/api/token-deal-edits/' + wid, { method: 'DELETE' })
  check('本人撤回成功', own.status === 200, 'status=' + own.status)

  const gone = await other.req('/api/token-deals/' + dealId + '/edits')
  check('撤回后不在列表', !gone.json?.edits?.some(e => e.id === wid))

  // 已通过/已驳回的不可撤回
  const st = await admin.req('/api/token-deal-edits/' + editId, { method: 'DELETE' })
  check('已通过的建议不可撤回 → 409', st.status === 409, 'status=' + st.status)
}

console.log('=== 15. 清理 ===')
{
  const del = await admin.req('/api/token-deals/' + dealId, { method: 'DELETE' })
  check('删除测试通告', del.status === 200, 'status=' + del.status)
  const gone = await anon.req('/api/token-deals/' + dealId)
  check('删除后详情 404', gone.status === 404, 'status=' + gone.status)
}

console.log('')
console.log('========================================')
console.log('通过: ' + pass + '  失败: ' + fail)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log('  - ' + f) }
process.exit(fail > 0 ? 1 : 0)
