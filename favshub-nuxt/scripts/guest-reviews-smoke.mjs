/**
 * 游客评测 + 头像代理 —— 容器内 HTTP 端到端冒烟
 *
 * 走真实 HTTP（非直接调服务层），重点验证静态检查抓不到的「跨链路形状不一致」：
 *   1. 人机校验端点 → 提交端点 的令牌/答案契约
 *   2. 游客身份 cookie 的下发与复用（同一 jar → 覆盖而非新建）
 *   3. 隐私：任何响应体与 HTML 中不得出现明文 QQ 号
 *   4. 头像代理：/avatar/<令牌>.jpg 能取到图，且令牌不可伪造
 *   5. 待审不外泄：pending 评测不出现在公开列表
 *   6. 审核通过后计入评分
 *   7. 评测打标（社区健康度第三维）：游客可打、切换取消、计数累加、
 *      列表回传 mark_count/my_marked、未过审不可打标、边界 404/400
 */
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000'

let pass = 0, fail = 0
const failures = []
function ok(cond, name, extra = '') {
  if (cond) { pass++ } else { fail++; failures.push(name); console.log('  ✗', name, extra) }
}
function eq(a, b, name) {
  const same = JSON.stringify(a) === JSON.stringify(b)
  if (!same) { fail++; failures.push(name); console.log('  ✗', name, `\n      got: ${JSON.stringify(a)}\n      exp: ${JSON.stringify(b)}`) }
  else pass++
}

/** 极简 cookie jar：按「访客」维度保存 Set-Cookie */
function makeJar() {
  const jar = new Map()
  return {
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    absorb(res) {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const c of raw) {
        const [pair] = c.split(';')
        const idx = pair.indexOf('=')
        if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
      }
    },
    get(name) { return jar.get(name) },
  }
}

async function req(method, path, { body, jar, headers = {}, expect } = {}) {
  const h = { ...headers }
  if (jar) {
    const c = jar.header()
    if (c) h.cookie = c
  }
  if (body !== undefined) h['content-type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  if (jar) jar.absorb(res)
  let data = null
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null)
  } else {
    data = Buffer.from(await res.arrayBuffer())
  }
  if (expect !== undefined) {
    ok(res.status === expect, `${method} ${path} → ${expect}`, `实际 ${res.status} ${data && data.error ? JSON.stringify(data.error) : ''}`)
  }
  return { status: res.status, data, res }
}

const QQ_TEST = '10001'
const QQ_TEST2 = '87654321'

async function main() {
  console.log(`\n基准地址: ${BASE}\n`)

  // ── 0. 前置：拿一条已通过的通告 ──
  console.log('══ 0. 准备数据 ══')
  const list = await req('GET', '/api/token-deals?limit=5', { expect: 200 })
  const deals = list.data?.deals || list.data?.items || []
  ok(deals.length > 0, '存在已通过的通告')
  if (!deals.length) {
    console.log('\n无可用通告，终止')
    process.exit(1)
  }
  const dealId = deals[0].id
  console.log(`  测试通告: ${dealId} (${deals[0].provider} - ${deals[0].title})`)

  // ── 1. 人机校验端点 ──
  console.log('\n══ 1. 人机校验端点 ══')
  const ch = await req('GET', `/api/token-deals/${dealId}/guest-review-challenge`, { expect: 200 })
  ok(typeof ch.data?.question === 'string' && ch.data.question.length > 0, '返回题目')
  ok(typeof ch.data?.token === 'string' && ch.data.token.includes('.'), '返回签名令牌')
  eq(ch.data?.expires_in, 600, '有效期 600 秒')
  console.log(`  题目: ${ch.data?.question}`)

  // 解出答案（从令牌 body 解析 —— 仅测试用）
  const payload = JSON.parse(Buffer.from(ch.data.token.split('.')[0], 'base64url').toString())

  // 不存在的通告 → 404
  await req('GET', '/api/token-deals/__no_such_deal__/guest-review-challenge', { expect: 404 })

  // ── 2. 提交游客评测（含 QQ 头像）──
  console.log('\n══ 2. 提交游客评测 ══')
  const jarGuest = makeJar()
  const submitBody = {
    nickname: '__smoke_guest',
    qq: QQ_TEST,
    rating: 5,
    content: '__smoke 这是一条自动化冒烟测试的游客评测内容。',
    challenge_token: ch.data.token,
    challenge_answer: payload.a,
  }
  const sub = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: submitBody, jar: jarGuest, expect: 200,
  })
  ok(sub.data?.success === true, '提交成功')
  eq(sub.data?.review?.status, 'pending', '默认状态 pending')
  eq(sub.data?.review?.nickname, '__smoke_guest', '昵称正确')
  const reviewId = sub.data?.review?.id
  ok(!!reviewId, '返回评测 id')
  ok(!!sub.data?.review?.avatar?.startsWith('/avatar/'), '返回 avatar 路径')

  // ★ 隐私：响应体不得含明文 QQ
  const subJson = JSON.stringify(sub.data)
  ok(!subJson.includes(QQ_TEST), '★ 提交响应不含明文 QQ 号')
  ok(!subJson.includes('qq_cipher'), '★ 响应不含 qq_cipher 字段')

  // 访客 cookie 已下发
  ok(!!jarGuest.get('favshub_visitor'), '★ 已下发访客 cookie')
  ok(/^[a-f0-9]{32}$/.test(String(jarGuest.get('favshub_visitor'))), '访客 cookie 为 32 位 hex')

  // ── 3. 令牌一次性 + 错误答案 ──
  console.log('\n══ 3. 人机校验边界 ══')
  const jarB = makeJar()
  // 复用已消耗的令牌
  const reuse = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: { ...submitBody, nickname: '__smoke_reuse' }, jar: jarB, expect: 400,
  })
  ok(String(reuse.data?.error || '').includes('已使用'), '★ 令牌不可重复使用')

  // 错误答案
  const ch2 = await req('GET', `/api/token-deals/${dealId}/guest-review-challenge`, { expect: 200 })
  const wrong = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: { ...submitBody, nickname: '__smoke_wrong', challenge_token: ch2.data.token, challenge_answer: 999999 },
    jar: jarB, expect: 400,
  })
  ok(String(wrong.data?.error || '').includes('不正确'), '错答被拒')

  // 伪造令牌
  const forged = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: { ...submitBody, nickname: '__smoke_forge', challenge_token: ch2.data.token.split('.')[0] + '.AAAAAAAAAAAAAAAAAAAAAAAA', challenge_answer: 1 },
    jar: jarB, expect: 400,
  })
  ok(!!forged.data?.error, '伪造令牌被拒')

  // 非法 QQ
  const ch3 = await req('GET', `/api/token-deals/${dealId}/guest-review-challenge`, { expect: 200 })
  const p3 = JSON.parse(Buffer.from(ch3.data.token.split('.')[0], 'base64url').toString())
  const badQQ = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: { ...submitBody, nickname: '__smoke_badqq', qq: 'abc', challenge_token: ch3.data.token, challenge_answer: p3.a },
    jar: jarB, expect: 400,
  })
  ok(String(badQQ.data?.error || '').includes('QQ'), '非法 QQ 号被拒')

  // ── 4. 同一访客覆盖 ──
  console.log('\n══ 4. 同一访客覆盖（cookie 身份）══')
  const ch4 = await req('GET', `/api/token-deals/${dealId}/guest-review-challenge`, { expect: 200 })
  const p4 = JSON.parse(Buffer.from(ch4.data.token.split('.')[0], 'base64url').toString())
  const overwrite = await req('POST', `/api/token-deals/${dealId}/guest-reviews`, {
    body: {
      nickname: '__smoke_guest', qq: QQ_TEST2, rating: 3,
      content: '__smoke 覆盖后的评测内容。',
      challenge_token: ch4.data.token, challenge_answer: p4.a,
    },
    jar: jarGuest, expect: 200,
  })
  eq(overwrite.data?.created, false, '★ 同一访客 → 覆盖（created:false）')
  eq(overwrite.data?.review?.id, reviewId, '覆盖同一条记录')
  eq(overwrite.data?.review?.rating, 3, '评分已更新为 3')

  // ── 5. 待审不外泄 ──
  console.log('\n══ 5. 待审不外泄 ══')
  const pubList = await req('GET', `/api/token-deals/${dealId}/guest-reviews`, { expect: 200 })
  const pubIds = (pubList.data?.reviews || []).map(r => r.id)
  ok(!pubIds.includes(reviewId), '★ pending 评测不在公开列表')
  const pubJson = JSON.stringify(pubList.data)
  ok(!pubJson.includes(QQ_TEST2), '★ 公开列表不含明文 QQ 号')
  ok(!pubJson.includes('__smoke'), '公开列表不含待审内容')

  // 合并列表（reviews.get）也不应含 pending
  const merged = await req('GET', `/api/token-deals/${dealId}/reviews?limit=50`, { expect: 200 })
  const mergedContents = JSON.stringify(merged.data)
  ok(!mergedContents.includes('__smoke 覆盖后的评测内容'), '★ 合并列表不含待审游客评测')

  // ★ 未过审的评测不可打标 —— 否则计数侧信道可探测「某人提交过评测」
  const markPending = await req('POST', `/api/token-deals/${dealId}/review-marks`, {
    body: { review_id: `g_${reviewId}` }, jar: jarGuest, expect: 404,
  })
  ok(markPending.status === 404, '★ 未过审的游客评测不可打标（404）')

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

  // 伪造/篡改令牌 → 404
  const bad1 = await req('GET', '/avatar/not-a-valid-token.jpg', { expect: 404 })
  ok(bad1.status === 404, '非法令牌 → 404')
  const tampered = avatarPath.replace(/\.jpg$/, '').slice(0, -4) + 'AAAA.jpg'
  const bad2 = await req('GET', tampered, { expect: 404 })
  ok(bad2.status === 404, '★ 篡改令牌 → 404')

  // ── 7. 管理员审核 ══
  console.log('\n══ 7. 管理员审核 ══')
  const jwt = process.env.SMOKE_JWT_ADMIN
  if (!jwt) {
    console.log('  (未提供 SMOKE_JWT_ADMIN，跳过审核链路)')
  } else {
    const auth = { authorization: `Bearer ${jwt}` }

    // 待审队列可见
    const queue = await req('GET', '/api/guest-reviews?limit=100', { headers: auth, expect: 200 })
    const qIds = (queue.data?.reviews || []).map(r => r.id)
    ok(qIds.includes(reviewId), '★ 管理员待审队列包含该评测')
    eq(queue.data?.scope, 'all', '管理员 scope=all')
    const qJson = JSON.stringify(queue.data)
    ok(!qJson.includes(QQ_TEST2), '★ 待审队列不含明文 QQ 号（含头像路径即可）')
    ok((queue.data?.pending_total ?? 0) >= 1, 'pending_total ≥ 1')

    // 未授权访问
    await req('GET', '/api/guest-reviews', { expect: 401 })

    // 通过
    const approve = await req('POST', `/api/guest-reviews/${reviewId}/review`, {
      headers: auth, body: { action: 'approve' }, expect: 200,
    })
    ok(approve.data?.success === true, '审核通过成功')
    eq(approve.data?.review?.status, 'approved', '状态为 approved')

    // 重复审核 → 409
    await req('POST', `/api/guest-reviews/${reviewId}/review`, {
      headers: auth, body: { action: 'approve' }, expect: 409,
    })

    // 公开列表现在包含它
    const pub2 = await req('GET', `/api/token-deals/${dealId}/guest-reviews`, { expect: 200 })
    const ids2 = (pub2.data?.reviews || []).map(r => r.id)
    ok(ids2.includes(reviewId), '★ 通过后出现在公开列表')
    const pub2Json = JSON.stringify(pub2.data)
    ok(!pub2Json.includes(QQ_TEST2), '★ 通过后公开列表仍不含明文 QQ 号')
    const item = (pub2.data.reviews || []).find(r => r.id === reviewId)
    ok(!!item?.avatar?.startsWith('/avatar/'), '公开项带 avatar 路径')

    // 合并列表也包含
    const merged2 = await req('GET', `/api/token-deals/${dealId}/reviews?limit=50`, { expect: 200 })
    const m2 = (merged2.data?.reviews || []).find(r => String(r.id) === `g_${reviewId}` || String(r.id).includes(reviewId))
    ok(!!m2, '★ 通过后出现在合并评测列表')
    if (m2) {
      eq(m2.source, 'guest', '来源标记为 guest')
      ok(!!m2.avatar, '合并列表项含 avatar')
      ok(!JSON.stringify(m2).includes(QQ_TEST2), '★ 合并列表项不含明文 QQ')
    }

    // 评分已计入
    const dealAfter = await req('GET', `/api/token-deals/${dealId}`, { expect: 200 })
    ok((dealAfter.data?.deal?.rating_count || 0) >= 1, '★ 评分人数已计入', `rating_count=${dealAfter.data?.deal?.rating_count}`)
    console.log(`  评分: ${dealAfter.data?.deal?.rating_sum}/${dealAfter.data?.deal?.rating_count}`)

    // 撤回：已通过不可撤回
    const wd = await req('DELETE', `/api/token-deals/${dealId}/guest-reviews/${reviewId}`, { headers: auth, expect: 409 })
    ok(wd.status === 409, '已通过的评测不可撤回（409）')

    // ── 7.5 评测打标（社区健康度第三维）──
    console.log('\n══ 7.5 评测打标 ══')
    const reviewKey = `g_${reviewId}`

    // 未登录访客也能打标
    const jarMarkA = makeJar()
    const mk1 = await req('POST', `/api/token-deals/${dealId}/review-marks`, {
      body: { review_id: reviewKey }, jar: jarMarkA, expect: 200,
    })
    ok(mk1.data?.success === true, '★ 游客可打标（无需登录）')
    eq(mk1.data?.marked, true, '首次打标 → marked=true')
    eq(mk1.data?.mark_count, 1, '计数为 1')

    // 同一访客再点 → 取消
    const mk2 = await req('POST', `/api/token-deals/${dealId}/review-marks`, {
      body: { review_id: reviewKey }, jar: jarMarkA, expect: 200,
    })
    eq(mk2.data?.marked, false, '★ 再点一次 → 取消')
    eq(mk2.data?.mark_count, 0, '取消后计数归零')

    // 重新标上，供后续列表断言
    await req('POST', `/api/token-deals/${dealId}/review-marks`, {
      body: { review_id: reviewKey }, jar: jarMarkA, expect: 200,
    })

    // 第二个访客（不同 jar）累加
    const jarMarkB = makeJar()
    const mk3 = await req('POST', `/api/token-deals/${dealId}/review-marks`, {
      body: { review_id: reviewKey }, jar: jarMarkB, expect: 200,
    })
    eq(mk3.data?.mark_count, 2, '★ 第二个访客累加为 2')

    // 列表附带计数与「我标过没」
    const listA = await req('GET', `/api/token-deals/${dealId}/reviews?limit=50`, { jar: jarMarkA, expect: 200 })
    const itemA = (listA.data?.reviews || []).find(r => String(r.id) === reviewKey)
    ok(!!itemA, '评测在列表中')
    eq(itemA?.mark_count, 2, '★ 列表返回 mark_count=2')
    eq(itemA?.my_marked, true, '★ 列表返回 my_marked=true（jarA 标过）')

    const listB = await req('GET', `/api/token-deals/${dealId}/reviews?limit=50`, { jar: makeJar(), expect: 200 })
    const itemB = (listB.data?.reviews || []).find(r => String(r.id) === reviewKey)
    eq(itemB?.my_marked, false, '★ 未标过的访客 → my_marked=false')
    eq(itemB?.mark_count, 2, '未标过的访客也看到总数 2')

    // 边界：不存在的评测 / 错误通告 / 缺参数
    const badReview = await req('POST', `/api/token-deals/${dealId}/review-marks`, {
      body: { review_id: 'g__no_such_review__' }, jar: makeJar(), expect: 404,
    })
    ok(badReview.status === 404, '打标不存在的评测 → 404')

    const badDeal = await req('POST', '/api/token-deals/__no_such_deal__/review-marks', {
      body: { review_id: reviewKey }, jar: makeJar(), expect: 404,
    })
    ok(badDeal.status === 404, '通告不存在 → 404')

    const noParam = await req('POST', `/api/token-deals/${dealId}/review-marks`, {
      body: {}, jar: makeJar(), expect: 400,
    })
    ok(noParam.status === 400, '缺少 review_id → 400')

    // 打标响应不得泄露 QQ 号
    ok(!JSON.stringify(mk1.data).includes(QQ_TEST2), '★ 打标响应不含明文 QQ 号')
  }

  // ── 8. 页面 HTML 隐私检查 ──
  console.log('\n══ 8. 页面 HTML 隐私 ══')
  const page = await fetch(`${BASE}/tokens`)
  const html = await page.text()
  ok(page.status === 200, '/tokens 返回 200')
  ok(!html.includes(QQ_TEST) && !html.includes(QQ_TEST2), '★ 页面 HTML 不含明文 QQ 号')
  // 头像路径若出现，必须是 /avatar/ 而非 qlogo 直链
  ok(!html.includes('qlogo.cn'), '★ 页面 HTML 不含 qlogo 直链（走服务端代理）')

  // ── 9. 页面可达性 ──
  console.log('\n══ 9. 页面可达性 ══')
  for (const p of ['/', '/tokens', '/collections', '/prompts', '/login']) {
    const r = await fetch(BASE + p)
    ok(r.status === 200, `GET ${p} → 200`, `实际 ${r.status}`)
  }

  // ── 清理 ──
  console.log('\n══ 10. 清理 ══')
  if (process.env.SMOKE_JWT_ADMIN && reviewId) {
    // 走 HTTP 撤回：已通过不可删，需直接删库 —— 此处仅提示
    console.log(`  注意：评测 ${reviewId} 已通过，需在部署后手动清理（冒烟库副本，非生产库）`)
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  if (failures.length) {
    console.log('\n失败项:')
    failures.forEach(f => console.log('  -', f))
    process.exit(1)
  }
  console.log('全部通过 ✓')
}

main().catch((e) => {
  console.error('冒烟异常:', e)
  process.exit(1)
})
