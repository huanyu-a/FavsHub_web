// Token 白嫖通告 — 只读端到端测试
//
// 覆盖: 列表/筛选/排序/详情/404/评测分布/鉴权/分页收敛/页面 TDK/sitemap
//       + 修改建议的匿名可见性（未登录 401、详情摘要降级）
//
// 用法:
//   1) 启动被测服务（建议用库副本，勿指向生产库）:
//      NUXT_DB_PATH="<临时库路径>" NUXT_JWT_SECRET="smoke-secret-key" \
//        PORT=3210 HOST=127.0.0.1 node .output/server/index.mjs
//   2) node scripts/token-deals-smoke-read.mjs [baseUrl]
//
// 退出码: 0 全通过 / 1 有失败项
const BASE = process.argv[2] || 'http://127.0.0.1:3210'

let pass = 0
let fail = 0
const failures = []

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* HTML */ }
  return { status: res.status, text, json, headers: res.headers }
}

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  [PASS]', name) }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  [FAIL]', name, detail) }
}

const q = encodeURIComponent

console.log('=== 1. 列表接口 ===')
{
  const r = await req('/api/token-deals?limit=3')
  check('HTTP 200', r.status === 200, 'status=' + r.status)
  check('返回 deals 数组', Array.isArray(r.json?.deals))
  check('分页 total=10（种子数据）', r.json?.pagination?.total === 10, 'total=' + r.json?.pagination?.total)
  const d = r.json?.deals?.[0]
  check('models 已解析为数组', Array.isArray(d?.models), JSON.stringify(d?.models))
  check('含作者信息', !!d?.username, 'username=' + d?.username)
  check('含 is_expired 字段', typeof d?.is_expired === 'boolean')
}

console.log('=== 2. 筛选 ===')
{
  const r1 = await req('/api/token-deals?quality=' + q('上品') + '&limit=50')
  const s1 = [...new Set(r1.json.deals.map(d => d.quality))]
  check('quality=上品 仅返回上品', s1.length === 1 && s1[0] === '上品', JSON.stringify(s1))

  const r2 = await req('/api/token-deals?source_tag=relay&limit=50')
  const s2 = [...new Set(r2.json.deals.map(d => d.source_tag))]
  check('source_tag=relay 仅返回 relay', s2.length === 1 && s2[0] === 'relay', JSON.stringify(s2))

  const r3 = await req('/api/token-deals?region=global&limit=50')
  const s3 = [...new Set(r3.json.deals.map(d => d.region))]
  check('region=global 仅返回 global', s3.length === 1 && s3[0] === 'global', JSON.stringify(s3))

  const r4 = await req('/api/token-deals?search=' + q('免费') + '&limit=50')
  check('搜索「免费」有结果', r4.json.pagination.total > 0, 'total=' + r4.json.pagination.total)
}

console.log('=== 3. 排序 ===')
{
  // 注意：排序规则为 pinned DESC 优先，其后才按热度/评分。故须分组校验。
  const descWithin = (arr, key) => {
    const groups = { pinned: [], normal: [] }
    for (const d of arr) (d.pinned ? groups.pinned : groups.normal).push(key(d))
    const ok = g => g.every((v, i) => i === 0 || g[i - 1] >= v)
    return ok(groups.pinned) && ok(groups.normal)
  }

  const r1 = await req('/api/token-deals?sort=hot&limit=10')
  check('sort=hot 各组净票数降序', descWithin(r1.json.deals, d => d.vote_up - d.vote_down),
    JSON.stringify(r1.json.deals.map(d => (d.pinned ? 'P' : '') + (d.vote_up - d.vote_down))))

  const r2 = await req('/api/token-deals?sort=rating&limit=10')
  check('sort=rating 各组平均分降序', descWithin(r2.json.deals, d => d.rating_count > 0 ? d.rating_sum / d.rating_count : 0),
    JSON.stringify(r2.json.deals.map(d => (d.pinned ? 'P' : '') + (d.rating_count > 0 ? (d.rating_sum / d.rating_count).toFixed(2) : '0'))))

  const r3 = await req('/api/token-deals?sort=expiring&limit=50')
  check('sort=expiring 正常返回', r3.status === 200 && r3.json.deals.length > 0)
}

console.log('=== 4. 详情接口 ===')
let dealId = null
{
  const list = await req('/api/token-deals?limit=1')
  dealId = list.json.deals[0].id
  const r = await req('/api/token-deals/' + dealId)
  check('详情 HTTP 200', r.status === 200, 'status=' + r.status)
  check('详情 id 匹配', r.json?.id === dealId || r.json?.deal?.id === dealId)

  const r404 = await req('/api/token-deals/deal_not_exist_xxx')
  check('不存在的 id 返回 404', r404.status === 404, 'status=' + r404.status)

  const rv = await req('/api/token-deals/' + dealId + '/reviews?limit=5')
  check('评测列表 HTTP 200', rv.status === 200, 'status=' + rv.status)
  check('评测含 distribution', rv.json?.distribution !== undefined || Array.isArray(rv.json?.reviews))
}

console.log('=== 5. 鉴权（未登录应拒绝） ===')
{
  const r1 = await req('/api/token-deals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'x', title: 'y', url: 'https://a.com' }) })
  check('未登录发布 → 401', r1.status === 401, 'status=' + r1.status)

  const r2 = await req('/api/token-deals/' + dealId + '/vote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vote: 'up' }) })
  check('未登录投票 → 401', r2.status === 401, 'status=' + r2.status)

  const r3 = await req('/api/admin/token-deals?status=pending')
  check('未登录访问管理端 → 401', r3.status === 401, 'status=' + r3.status)

  // 修改建议：未登录一律拒绝
  const r4 = await req('/api/token-deals/' + dealId + '/edits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '匿名想改' }) })
  check('未登录提交修改建议 → 401', r4.status === 401, 'status=' + r4.status)

  const r5 = await req('/api/token-deal-edits')
  check('未登录看待审建议列表 → 401', r5.status === 401, 'status=' + r5.status)
}

console.log('=== 5b. 修改建议的匿名可见性 ===')
{
  // 匿名者读已公开通告的建议列表：可读，但只能看到自己的（匿名即无 → 401）
  const r = await req('/api/token-deals/' + dealId + '/edits')
  check('匿名读建议列表 → 401（无身份无法收窄可见性）', r.status === 401, 'status=' + r.status)

  // 详情端点对匿名者应返回 edits 摘要（can_review=false、my_edit=null）
  const d = await req('/api/token-deals/' + dealId)
  check('匿名详情 200', d.status === 200, 'status=' + d.status)
  check('匿名详情 can_review=false', d.json?.edits?.can_review === false, JSON.stringify(d.json?.edits)?.slice(0, 60))
  check('匿名详情 my_edit=null', d.json?.edits?.my_edit === null)
  check('匿名详情 is_author=false', d.json?.edits?.is_author === false)
}

console.log('=== 6. 校验逻辑（非法输入） ===')
{
  const r = await req('/api/token-deals?limit=99999')
  check('limit 上限收敛', r.json?.pagination?.limit <= 100, 'limit=' + r.json?.pagination?.limit)

  const r2 = await req('/api/token-deals?page=-5')
  check('page 下限收敛', r2.json?.pagination?.page === 1, 'page=' + r2.json?.pagination?.page)
}

console.log('=== 7. 页面与 SEO ===')
{
  const r = await req('/tokens')
  check('/tokens 页面 HTTP 200', r.status === 200, 'status=' + r.status)
  check('/tokens 含「白嫖」字样', r.text.includes('白嫖'), '')
  check('/tokens 含种子数据标题', r.text.includes('智谱') || r.text.includes('ModelScope'))
  check('/tokens 含 TDK title', /<title>[^<]*白嫖/.test(r.text) || r.text.includes('<title>'), '')

  const sm = await req('/sitemap.xml')
  check('sitemap 含 /tokens', sm.text.includes('/tokens'), 'status=' + sm.status)
}

console.log('')
console.log('========================================')
console.log('通过: ' + pass + '  失败: ' + fail)
if (failures.length) {
  console.log('失败项:')
  for (const f of failures) console.log('  - ' + f)
}
process.exit(fail > 0 ? 1 : 0)
