/**
 * 游客评测 + 头像代理 —— **生产环境**端到端验证（自清理）
 *
 * 与 guest-reviews-smoke.mjs 的分工：
 *   - guest-reviews-smoke.mjs      跑在**库副本**上，会留下一条已通过评测（仅提示手工清理）
 *   - 本脚本                        跑在**生产**上，所有写入隔离在一条临时通告内，
 *                                  最后删除该通告（端点显式删子表），做到零残留
 *
 * 覆盖：人机校验 → 提交 → 覆盖 → 待审不外泄 → 头像代理 → 审核 →
 *       评测打标（社区健康度第三维）→ 可用性投票（游客可投）→
 *       页面 HTML 隐私 → 页面可达性 → 自清理
 *
 * 用法（在服务器上跑，BASE 指第 2 层 nginx 权威源）：
 *   BASE=http://127.0.0.1:3090 SMOKE_JWT_ADMIN=<管理员 JWT> node guest-reviews-smoke-prod.mjs
 *
 * JWT 签发（容器内，需 NUXT_JWT_SECRET）：
 *   docker exec <app容器> node -e '
 *     const c=require("crypto"), b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
 *     const now=Math.floor(Date.now()/1000), h=b64({alg:"HS256",typ:"JWT"});
 *     const p=b64({id:1,username:"<管理员>",iat:now,exp:now+1800});
 *     const s=c.createHmac("sha256",process.env.NUXT_JWT_SECRET).update(h+"."+p).digest("base64url");
 *     process.stdout.write(h+"."+p+"."+s);' > /tmp/jwt.txt
 *
 * ⚠️ 限频与可重复性：脚本在宿主上跑时，所有请求的对端地址相同（docker 网关），
 *    会共用同一个「每 IP 每小时 3 次」配额 → 短时间重复跑会撞 429（属正确行为，非缺陷）。
 *    故本脚本为每个「访客」注入**独立的 X-Forwarded-For**（模拟不同访客的真实 IP），
 *    既贴近真实场景，也让脚本可重复执行。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3090'
const JWT = process.env.SMOKE_JWT_ADMIN
const TAG = '__pv'

let pass = 0, fail = 0
const failures = []
function ok(cond, name, extra = '') {
  if (cond) pass++
  else { fail++; failures.push(name); console.log('  ✗', name, extra) }
}
function eq(a, b, name) {
  const same = JSON.stringify(a) === JSON.stringify(b)
  if (!same) { fail++; failures.push(name); console.log('  ✗', name, `\n      got: ${JSON.stringify(a)}\n      exp: ${JSON.stringify(b)}`) }
  else pass++
}
/** 极简 cookie jar：按「访客」维度保存 Set-Cookie；`ip` 为该访客模拟的来源 IP */
function jar(ip) {
  const j = new Map()
  return {
    ip,
    header() { return [...j.entries()].map(([k, v]) => `${k}=${v}`).join('; ') },
    absorb(res) {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const c of raw) {
        const [pair] = c.split(';')
        const i = pair.indexOf('=')
        if (i > 0) j.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
    },
    get(n) { return j.get(n) },
  }
}

/**
 * 为每个访客分配独立来源 IP。
 *
 * 用 198.51.100.0/24 与 203.0.113.0/24（RFC 5737 文档保留段，不会与真实访客冲突），
 * **每次运行随机选一个 /24 + 起始偏移** → 保证多次运行不共用「每 IP 每小时」配额
 * （否则第二次跑就会撞 429，看起来像功能坏了）。
 */
const IP_BLOCKS = ['198.51.100', '203.0.113']
const RUN_BLOCK = IP_BLOCKS[Math.floor(Math.random() * IP_BLOCKS.length)]
const RUN_OFFSET = Math.floor(Math.random() * 200)   // 0..199，留出余量给同次运行的多个访客
let ipSeq = 0
function nextIp() {
  const last = 1 + ((RUN_OFFSET + ipSeq++) % 254)
  return `${RUN_BLOCK}.${last}`
}

async function req(method, path, { body, jar: jr, headers = {}, expect, ip } = {}) {
  const h = { ...headers }
  if (jr) { const c = jr.header(); if (c) h.cookie = c }
  // 模拟真实访客来源 IP（经可信反代 → nginx realip → 应用 X-Real-IP 链路）
  const srcIp = ip || (jr && jr.ip)
  if (srcIp) h['x-forwarded-for'] = srcIp
  if (body !== undefined) h['content-type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method, headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  if (jr) jr.absorb(res)
  let data = null
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) data = await res.json().catch(() => null)
  else data = Buffer.from(await res.arrayBuffer())
  if (expect !== undefined) {
    ok(res.status === expect, `${method} ${path} → ${expect}`,
      `实际 ${res.status} ${data && data.error ? JSON.stringify(data.error) : ''}`)
  }
  return { status: res.status, data, res }
}

const QQ = '10001'
const QQ2 = '87654321'
const auth = { authorization: `Bearer ${JWT}` }
let dealId = null

async function main() {
  if (!JWT) { console.error('缺少 SMOKE_JWT_ADMIN'); process.exit(1) }
  console.log(`\n基准地址: ${BASE}`)

  // ── 0. 建临时通告（把所有写入隔离在它下面，最后删掉）──
  console.log('\n══ 0. 建临时通告（隔离所有写入）══')
  const created = await req('POST', '/api/token-deals', {
    headers: auth, expect: 200,
    body: {
      provider: `${TAG}_provider`, title: `${TAG} 生产验证临时通告`,
      url: 'https://example.com/pv', call_url: 'https://example.com/pv/v1',
      quota: '0', models: ['pv-model'],
      // 枚举取值：quality ∈ 上上品/上品/中品/下品/下下品；region ∈ cn/global
      //          source_tag ∈ official/relay/community
      region: 'cn', quality: '中品', source_tag: 'community', note: `${TAG} temp`,
    },
  })
  dealId = created.data?.deal_id
  eq(created.data?.status, 'approved', '临时通告已 approved')
  ok(!!dealId, '拿到临时通告 id')
  if (!dealId) { console.log('无法建临时通告，终止'); process.exit(1) }
  console.log(`  临时通告: ${dealId}`)

  // ── 1. 人机校验端点 ──
  console.log('\n══ 1. 人机校验端点 ══')
  const ch = await req('GET', `/api/token-deals/${dealId}/guest-review-challenge`, { expect: 200 })
  ok(typeof ch.data?.question === 'string' && ch.data.question.length > 0, '返回题目')
  ok(typeof ch.data?.token === 'string' && ch.data.token.includes('.'), '返回签名令牌')
  eq(ch.data?.expires_in, 600, '有效期 600 秒')
  const payload = JSON.parse(Buffer.from(ch.data.token.split('.')[0], 'base64url').toString())

  await req('GET', '/api/token-deals/__no_such__/guest-review-challenge', { expect: 404 })

  // ── 2. 提交游客评测（含 QQ 头像）──
  console.log('\n══ 2. 提交游客评测 ══')
  const g1 = jar(nextIp())
  const body1 = {
    nickname: `${TAG}_guest`, qq: QQ, rating: 5,
    content: `${TAG} 生产验证用评测内容。`,
    challenge_token: ch.data.token, challenge_answer: payload.a,
  }
  const sub = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, { body: body1, jar: g1, expect: 200 })
  ok(sub.data?.success === true, '提交成功')
  eq(sub.data?.review?.status, 'pending', '默认 pending')
  eq(sub.data?.review?.nickname, `${TAG}_guest`, '昵称正确')
  const reviewId = sub.data?.review?.id
  ok(!!reviewId, '返回评测 id')
  ok(!!sub.data?.review?.avatar?.startsWith('/avatar/'), '返回 avatar 路径')

  const subJson = JSON.stringify(sub.data)
  ok(!subJson.includes(QQ), '★ 提交响应不含明文 QQ 号')
  ok(!subJson.includes('qq_cipher'), '★ 响应不含 qq_cipher 字段')
  ok(!!g1.get('favshub_visitor'), '★ 已下发访客 cookie')
  ok(/^[a-f0-9]{32}$/.test(String(g1.get('favshub_visitor'))), '访客 cookie 为 32 位 hex')

  // ── 3. 人机校验边界 ──
  console.log('\n══ 3. 人机校验边界 ══')
  const g2 = jar(nextIp())
  const reuse = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: { ...body1, nickname: `${TAG}_reuse` }, jar: g2, expect: 400,
  })
  ok(String(reuse.data?.error || '').includes('已使用'), '★ 令牌不可重复使用')

  const ch2 = await req('GET', `/api/token-deals/${dealId}/guest-review-challenge`, { expect: 200 })
  const wrong = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: { ...body1, nickname: `${TAG}_wrong`, challenge_token: ch2.data.token, challenge_answer: 999999 },
    jar: g2, expect: 400,
  })
  ok(String(wrong.data?.error || '').includes('不正确'), '错答被拒')

  const forged = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: {
      ...body1, nickname: `${TAG}_forge`,
      challenge_token: ch2.data.token.split('.')[0] + '.AAAAAAAAAAAAAAAAAAAAAAAA',
      challenge_answer: 1,
    },
    jar: g2, expect: 400,
  })
  ok(!!forged.data?.error, '伪造令牌被拒')

  const ch3 = await req('GET', `/api/token-deals/${dealId}/guest-review-challenge`, { expect: 200 })
  const p3 = JSON.parse(Buffer.from(ch3.data.token.split('.')[0], 'base64url').toString())
  const badQQ = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: { ...body1, nickname: `${TAG}_badqq`, qq: 'abc', challenge_token: ch3.data.token, challenge_answer: p3.a },
    jar: g2, expect: 400,
  })
  ok(String(badQQ.data?.error || '').includes('QQ'), '非法 QQ 号被拒')

  // ── 4. 同访客覆盖（cookie 身份）──
  console.log('\n══ 4. 同访客覆盖 ══')
  const ch4 = await req('GET', `/api/token-deals/${dealId}/guest-review-challenge`, { expect: 200 })
  const p4 = JSON.parse(Buffer.from(ch4.data.token.split('.')[0], 'base64url').toString())
  const ov = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: {
      nickname: `${TAG}_guest`, qq: QQ2, rating: 3,
      content: `${TAG} 覆盖后内容。`,
      challenge_token: ch4.data.token, challenge_answer: p4.a,
    },
    jar: g1, expect: 200,
  })
  eq(ov.data?.created, false, '★ 同访客 → 覆盖（created:false）')
  eq(ov.data?.review?.id, reviewId, '覆盖同一条记录')
  eq(ov.data?.review?.rating, 3, '评分更新为 3')
  ok(!JSON.stringify(ov.data).includes(QQ2), '★ 覆盖响应不含明文 QQ')

  // ── 5. 待审不外泄 ──
  console.log('\n══ 5. 待审不外泄 ══')
  const pub = await req('GET', `/api/token-deals/${dealId}/guest-reviews`, { expect: 200 })
  ok(!(pub.data?.reviews || []).map(r => r.id).includes(reviewId), '★ pending 不在公开列表')
  ok(!JSON.stringify(pub.data).includes(TAG), '公开列表不含待审内容')
  const merged = await req('GET', `/api/token-deals/${dealId}/reviews?limit=50`, { expect: 200 })
  ok(!JSON.stringify(merged.data).includes(`${TAG} 覆盖后内容`), '★ 合并列表不含待审游客评测')

  // ── 6. 头像代理 ──
  console.log('\n══ 6. 头像代理 ══')
  const avatarPath = sub.data.review.avatar
  const av = await req('GET', avatarPath)
  ok(av.status === 200, '头像端点返回 200', `实际 ${av.status}`)
  const avBuf = Buffer.isBuffer(av.data) ? av.data : Buffer.alloc(0)
  ok(avBuf.length > 200, '★ 返回真实图片字节', `size=${avBuf.length}`)
  ok(/^image\//.test(av.res.headers.get('content-type') || ''), 'content-type 为图片')
  ok(/max-age=\d{6,}/.test(av.res.headers.get('cache-control') || ''), '★ 头像长缓存头已下发')
  console.log(`  头像: ${avBuf.length} bytes, ${av.res.headers.get('content-type')}`)
  await req('GET', '/avatar/not-a-valid-token.jpg', { expect: 404 })
  await req('GET', avatarPath.replace(/\.jpg$/, '').slice(0, -4) + 'AAAA.jpg', { expect: 404 })
  ok(true, '★ 非法/篡改令牌 → 404')

  // ── 7. 管理员审核 ──
  console.log('\n══ 7. 管理员审核 ══')
  const queue = await req('GET', '/api/guest-reviews?limit=100', { headers: auth, expect: 200 })
  ok((queue.data?.reviews || []).map(r => r.id).includes(reviewId), '★ 管理员待审队列包含该评测')
  eq(queue.data?.scope, 'all', '管理员 scope=all')
  ok(!JSON.stringify(queue.data).includes(QQ2), '★ 待审队列不含明文 QQ 号')
  ok((queue.data?.pending_total ?? 0) >= 1, 'pending_total ≥ 1')
  await req('GET', '/api/guest-reviews', { expect: 401 })

  const app = await req('POST', `/api/guest-reviews/${reviewId}/review`, {
    headers: auth, body: { action: 'approve' }, expect: 200,
  })
  ok(app.data?.success === true, '审核通过成功')
  eq(app.data?.review?.status, 'approved', '状态为 approved')
  await req('POST', `/api/guest-reviews/${reviewId}/review`, { headers: auth, body: { action: 'approve' }, expect: 409 })

  const pub2 = await req('GET', `/api/token-deals/${dealId}/guest-reviews`, { expect: 200 })
  ok((pub2.data?.reviews || []).map(r => r.id).includes(reviewId), '★ 通过后出现在公开列表')
  ok(!JSON.stringify(pub2.data).includes(QQ2), '★ 通过后公开列表仍不含明文 QQ')
  ok(!!(pub2.data?.reviews || []).find(r => r.id === reviewId)?.avatar?.startsWith('/avatar/'), '公开项带 avatar 路径')

  const merged2 = await req('GET', `/api/token-deals/${dealId}/reviews?limit=50`, { expect: 200 })
  const m2 = (merged2.data?.reviews || []).find(r => String(r.id).includes(reviewId))
  ok(!!m2, '★ 通过后出现在合并评测列表')
  if (m2) { eq(m2.source, 'guest', '来源标记 guest'); ok(!!m2.avatar, '合并项含 avatar') }

  const dealAfter = await req('GET', `/api/token-deals/${dealId}`, { expect: 200 })
  ok((dealAfter.data?.deal?.rating_count || 0) >= 1, '★ 评分人数已计入',
    `rating_count=${dealAfter.data?.deal?.rating_count}`)
  console.log(`  评分: ${dealAfter.data?.deal?.rating_sum}/${dealAfter.data?.deal?.rating_count}`)
  await req('DELETE', `/api/token-deals/${dealId}/guest-reviews/${reviewId}`, { headers: auth, expect: 409 })

  // ── 7.5 评测打标（社区健康度第三维，自清理）──
  console.log('\n══ 7.5 评测打标 ══')
  const reviewKey = `g_${reviewId}`
  const jarMarkA = jar(nextIp())
  const jarMarkB = jar(nextIp())

  const mk1 = await req('POST', `/api/token-deals/${dealId}/review-marks`, {
    body: { review_id: reviewKey }, jar: jarMarkA, expect: 200,
  })
  ok(mk1.data?.success === true, '★ 游客可打标（无需登录）')
  eq(mk1.data?.marked, true, '首次打标 → marked=true')
  eq(mk1.data?.mark_count, 1, '计数为 1')

  const mk2 = await req('POST', `/api/token-deals/${dealId}/review-marks`, {
    body: { review_id: reviewKey }, jar: jarMarkA, expect: 200,
  })
  eq(mk2.data?.marked, false, '★ 再点一次 → 取消')
  eq(mk2.data?.mark_count, 0, '取消后计数归零')

  await req('POST', `/api/token-deals/${dealId}/review-marks`, {
    body: { review_id: reviewKey }, jar: jarMarkA, expect: 200,
  })
  const mk3 = await req('POST', `/api/token-deals/${dealId}/review-marks`, {
    body: { review_id: reviewKey }, jar: jarMarkB, expect: 200,
  })
  eq(mk3.data?.mark_count, 2, '★ 第二个访客累加为 2')

  const listA = await req('GET', `/api/token-deals/${dealId}/reviews?limit=50`, { jar: jarMarkA, expect: 200 })
  const itemA = (listA.data?.reviews || []).find(r => String(r.id) === reviewKey)
  ok(!!itemA, '评测在列表中')
  eq(itemA?.mark_count, 2, '★ 列表返回 mark_count=2')
  eq(itemA?.my_marked, true, '★ 列表返回 my_marked=true（jarA 标过）')
  const listB = await req('GET', `/api/token-deals/${dealId}/reviews?limit=50`, { jar: jar(nextIp()), expect: 200 })
  const itemB = (listB.data?.reviews || []).find(r => String(r.id) === reviewKey)
  eq(itemB?.my_marked, false, '★ 未标过的访客 → my_marked=false')
  eq(itemB?.mark_count, 2, '未标过的访客也看到总数 2')

  await req('POST', `/api/token-deals/${dealId}/review-marks`, {
    body: { review_id: 'g__no_such_review__' }, jar: jar(nextIp()), expect: 404,
  })
  ok(true, '打标不存在的评测 → 404')
  await req('POST', '/api/token-deals/__no_such_deal__/review-marks', {
    body: { review_id: reviewKey }, jar: jar(nextIp()), expect: 404,
  })
  ok(true, '通告不存在 → 404')
  await req('POST', `/api/token-deals/${dealId}/review-marks`, {
    body: {}, jar: jar(nextIp()), expect: 400,
  })
  ok(true, '缺少 review_id → 400')

  // ── 7.6 可用性投票（游客可投，无需登录）──
  console.log('\n══ 7.6 可用性投票 ══')
  {
    const jarVoteA = jar(nextIp())
    const jarVoteB = jar(nextIp())

    const vt1 = await req('POST', `/api/token-deals/${dealId}/vote`, {
      body: { vote: 'up' }, jar: jarVoteA, expect: 200,
    })
    ok(vt1.data?.success === true, '★ 游客可投票（无需登录）')
    eq(vt1.data?.my_vote, 'up', '首次投票 → my_vote=up')
    eq(vt1.data?.vote_up, 1, 'vote_up=1')

    const vt2 = await req('POST', `/api/token-deals/${dealId}/vote`, {
      body: { vote: 'up' }, jar: jarVoteA, expect: 200,
    })
    eq(vt2.data?.my_vote, null, '★ 再点同方向 → 取消')
    eq(vt2.data?.vote_up, 0, '取消后 vote_up 归零')

    await req('POST', `/api/token-deals/${dealId}/vote`, { body: { vote: 'up' }, jar: jarVoteA, expect: 200 })
    const vt3 = await req('POST', `/api/token-deals/${dealId}/vote`, {
      body: { vote: 'down' }, jar: jarVoteA, expect: 200,
    })
    eq(vt3.data?.my_vote, 'down', '★ 投反方向 → 改票')
    eq(vt3.data?.vote_up, 0, '改票后 vote_up 归零')
    eq(vt3.data?.vote_down, 1, 'vote_down=1')

    const vt4 = await req('POST', `/api/token-deals/${dealId}/vote`, {
      body: { vote: 'up' }, jar: jarVoteB, expect: 200,
    })
    eq(vt4.data?.vote_up, 1, '★ 第二访客累加 → vote_up=1')
    eq(vt4.data?.vote_down, 1, 'vote_down 仍为 1')

    const detailA = await req('GET', `/api/token-deals/${dealId}`, { jar: jarVoteA, expect: 200 })
    eq(detailA.data?.my_vote, 'down', '★ 详情端点对游客回传 my_vote')
    const detailC = await req('GET', `/api/token-deals/${dealId}`, { jar: jar(nextIp()), expect: 200 })
    eq(detailC.data?.my_vote, null, '未投票访客 → my_vote=null')

    await req('POST', `/api/token-deals/${dealId}/vote`, {
      body: { vote: 'sideways' }, jar: jar(nextIp()), expect: 400,
    })
    ok(true, '非法方向 → 400')
    await req('POST', '/api/token-deals/__no_such_deal__/vote', {
      body: { vote: 'up' }, jar: jar(nextIp()), expect: 404,
    })
    ok(true, '通告不存在 → 404')
    await req('POST', `/api/token-deals/${dealId}/vote`, {
      body: {}, jar: jar(nextIp()), expect: 400,
    })
    ok(true, '缺少 vote → 400')
  }

  // ── 8. 页面 HTML 隐私 ──
  console.log('\n══ 8. 页面 HTML 隐私 ══')
  const page = await fetch(`${BASE}/tokens`)
  const html = await page.text()
  ok(page.status === 200, '/tokens 返回 200')
  ok(!html.includes(QQ) && !html.includes(QQ2), '★ HTML 不含明文 QQ')
  ok(!html.includes('qlogo.cn'), '★ HTML 不含 qlogo 直链（走服务端代理）')

  // ── 9. 页面可达性 ──
  console.log('\n══ 9. 页面可达性 ══')
  for (const p of ['/', '/tokens', '/collections', '/prompts', '/login', '/tokens/eval/']) {
    const r = await fetch(BASE + p)
    ok(r.status === 200, `GET ${p} → 200`, `实际 ${r.status}`)
  }

  // ── 10. 清理：删除临时通告（端点显式删子表，不依赖 FK 级联）──
  console.log('\n══ 10. 清理临时通告 ══')
  await req('DELETE', `/api/token-deals/${dealId}`, { headers: auth, expect: 200 })
  await req('GET', `/api/token-deals/${dealId}`, { expect: 404 })
  ok(true, '★ 删除后详情 404')
  await req('GET', `/api/token-deals/${dealId}/guest-review-challenge`, { expect: 404 })
  ok(true, '★ 删除后不再出题')
  dealId = null // 已清理，异常分支无需再删

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  if (failures.length) {
    console.log('\n失败项:')
    failures.forEach(f => console.log('  -', f))
    process.exit(1)
  }
  console.log('全部通过 ✓')
}

main().catch(async (e) => {
  console.error('验证异常:', e)
  try {
    if (dealId) {
      await fetch(`${BASE}/api/token-deals/${dealId}`, { method: 'DELETE', headers: auth })
      console.error(`已尝试清理临时通告 ${dealId}`)
    }
  } catch {}
  process.exit(1)
})
