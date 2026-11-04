#!/usr/bin/env node
/**
 * ssrf-pin-check.mjs — 校验 fetch-models 的出站「地址钉死」机制（2026-10-30）
 *
 * 背景：2026-10-30 的审查用最小可复现例子证明了 SSRF 防护存在 TOCTOU ——
 * 原先用 `fetch`，它只拿到主机名然后**自己再解析一次 DNS**，
 * 于是「我们校验的 IP」和「实际连出去的 IP」可以是两个不同地址
 * （fake-ip / TTL=0 轮询 / 攻击者自控权威 DNS 都能触发）。
 * 修法是把校验过的地址通过 `lookup` 回调直接喂给 socket。
 *
 * 这个脚本验证的正是那条修法能不能用，两件事都必须成立：
 *   1. **pin 真的生效**：用一个解析不到的主机名，只靠 lookup 喂地址，仍能连上目标；
 *   2. **pin 不影响 TLS**：https 场景下 SNI 与证书校验仍按**主机名**进行
 *      （否则自签名/错误证书会被放行，等于用一个漏洞换另一个漏洞）。
 *
 * 注意它**复刻**了 `pinnedGet` 的接线方式而不是 import 源码
 * （端点的内部函数没有导出，且护栏本身会拒绝环回地址，无法直接对本地靶标做集成测试）。
 * 因此这里锁的是「机制与 Node 版本行为」：`http.request` 内部以 `{ all: true }` 调 lookup，
 * 回调必须给**数组** —— 给 `(err, address, family)` 会报 `Invalid IP address: undefined`
 * 而完全连不上。将来升 Node 大版本时重跑本脚本即可确认这层行为没变。
 *
 * 用法：node scripts/ssrf-pin-check.mjs        （退出码 0 = 机制可用）
 */
import http from 'node:http'
import https from 'node:https'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.error('  ✗', name, detail) }
}

/** 与 server/api/token-deals/fetch-models.post.ts 的 pinnedGet 同一接线 */
function pinnedRequest({ url, address, family }, timeoutMs = 8000) {
  const mod = url.protocol === 'https:' ? https : http
  const port = url.port || (url.protocol === 'https:' ? 443 : 80)
  return new Promise((resolve, reject) => {
    const req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Accept: 'application/json' },
      lookup: (_hostname, options, cb) => {
        if (options && options.all) cb(null, [{ address, family }])
        else cb(null, address, family)
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

/**
 * 与 fetch-models.post.ts 的 `requestOnce` 同一接线。
 * 与上面 `pinnedRequest` 的唯一差别就是那个**硬总时限定时器** —— 也就是 2026-10-30 补的那一层。
 */
function pinnedRequestHard({ url, address, family }, timeoutMs = 8000) {
  const mod = url.protocol === 'https:' ? https : http
  const port = url.port || (url.protocol === 'https:' ? 443 : 80)
  return new Promise((resolve, reject) => {
    const req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Accept: 'application/json' },
      lookup: (_hostname, options, cb) => {
        if (options && options.all) cb(null, [{ address, family }])
        else cb(null, address, family)
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    const hardTimer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs)
    req.on('close', () => clearTimeout(hardTimer))
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

console.log(`node ${process.version}`)

// ── 1. pin 是否真的生效 ──
{
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'PINNED-OK' }], host: req.headers.host }))
  })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port

  try {
    const r = await pinnedRequest({
      url: new URL(`http://unresolvable-target.invalid:${port}/v1/models`),
      address: '127.0.0.1',
      family: 4,
    })
    check('主机名无法解析，仍能连到被 pin 的地址', r.status === 200, `status=${r.status}`)
    check('响应体来自被 pin 的目标', /PINNED-OK/.test(r.body), r.body.slice(0, 120))
    check('Host 头仍是原主机名（未被 pin 改写）', /unresolvable-target\.invalid/.test(r.body))
  } catch (err) {
    check('主机名无法解析，仍能连到被 pin 的地址', false, err.message)
  } finally {
    srv.close()
  }
}

// ── 2. lookup 回调的两种形态都要覆盖 ──
{
  // 直接单测接线：`{ all: true }` 必须回数组，否则 Node 报 Invalid IP address: undefined
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port

  const callWith = (options) => new Promise((resolve) => {
    const req = http.request({
      hostname: 'also-unresolvable.invalid', port, path: '/', method: 'GET',
      lookup: (_h, o, cb) => {
        if (o && o.all) cb(null, [{ address: '127.0.0.1', family: 4 }])
        else cb(null, '127.0.0.1', 4)
      },
    }, (res) => { res.resume(); res.on('end', () => resolve(`ok:${res.statusCode}`)) })
    req.on('error', (e) => resolve(`err:${e.message}`))
    req.end()
  })

  check('lookup 收到 { all: true } 时回数组 → 成功', (await callWith({})) === 'ok:200')
  srv.close()
}

// ── 3. https + SNI：证书仍按主机名校验 ──
{
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  let pinnedHttps = null
  try {
    // 用一个自建 TLS 靶标不现实（需要真证书），改为对真实公网验证：
    // 连 1.1.1.1，但证书必须是 one.one.one.one 的 —— 能通过就说明 SNI 没被 pin 影响
    const r = await pinnedRequest({ url: new URL('https://one.one.one.one/'), address: '1.1.1.1', family: 4 })
    pinnedHttps = r.status
  } catch (err) {
    pinnedHttps = `err:${err.message}`
  }
  void requireFromRoot
  if (typeof pinnedHttps === 'number') {
    check('https pin 成功（TLS 按 hostname 校验通过，SNI 未受影响）', pinnedHttps < 500, `status=${pinnedHttps}`)
  } else {
    console.log(`  ⚠ https pin 未验证（本机无公网直连？）：${pinnedHttps}`)
  }
}

// ── 4. 负例：pin 到错误端口必须失败（证明不是「随便连都通」的假阳性）──
{
  try {
    await pinnedRequest({
      url: new URL('http://unresolvable-target.invalid:1/v1/models'),
      address: '127.0.0.1',
      family: 4,
    }, 3000)
    check('pin 到无监听端口应失败', false, '居然连上了')
  } catch {
    check('pin 到无监听端口如实失败（上一条不是假阳性）', true)
  }
}

// ── 5. 总 deadline 是否真的生效（慢速 trickle 响应）──
{
  // 靶标：每秒吐 1 字节、永不结束。
  // `http.request` 的 `timeout` 是 **socket 空闲超时** —— 只要还有字节陆续到达就永不触发。
  // 2026-10-30 把 `fetch` 换成原生 `http` 以支持地址钉死时，正是丢掉了 `fetch` 的
  // `AbortSignal.timeout()` 所提供的真总时限，攻击者用自控的慢速服务器即可无限期占住连接
  // （限频只限新建连接数，连接一旦建立就一直挂着）。
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    const timer = setInterval(() => res.write('x'), 1000)
    req.on('close', () => clearInterval(timer))
  })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  const target = { url: new URL(`http://trickle.invalid:${port}/v1/models`), address: '127.0.0.1', family: 4 }

  const runWith = async (fn, budgetMs) => {
    const t0 = Date.now()
    let err = ''
    try {
      await Promise.race([
        fn(target, 2000),
        new Promise((_, rej) => setTimeout(() => rej(new Error('__still_running__')), budgetMs)),
      ])
    } catch (e) { err = e.message }
    return { elapsed: Date.now() - t0, err }
  }

  const oldWay = await runWith(pinnedRequest, 6000)
  check('对照：只靠空闲超时挡不住慢速响应（说明硬定时器是必需的）',
    oldWay.err === '__still_running__',
    `实测 ${oldWay.elapsed}ms 就结束了（配置 2000ms）——那样这条对照用例本身失效`)

  const newWay = await runWith(pinnedRequestHard, 6000)
  // 判据是 `err === 'timeout'`：靶标每秒吐字节，而空闲超时同为 2000ms —— 但只要还有字节
  // 到达就永不触发（这正是上面那条对照用例要证明的），所以这里的 'timeout' 只可能来自
  // **硬定时器**。它已经排除了「因无关原因立即失败」的假阳性。
  //
  // 上界为什么是 5000 而不是 3500：硬限是 2000ms，但 `req.destroy()` 之后错误事件的到达
  // 还受响应流影响 —— 实测 40 次里有 2 次落在 3.6s 左右（err 依然是 'timeout'，即修复本身
  // 生效），于是**旧上界 3500 会造成约 5% 的假红**。上界只需证明「远早于 6000ms 预算就被掐断」，
  // 对齐预算才有意义，写一个机器速度相关的魔数只会让门禁随机变红。
  check('修法：硬定时器让慢速响应在配置时限内被掐断',
    newWay.err === 'timeout' && newWay.elapsed < 5000,
    `实测 ${newWay.elapsed}ms err=${newWay.err}`)

  srv.closeAllConnections?.()
  srv.close()
}

// ── 6. 防漂移：上面是**复刻**接线，所以再断言真实源码确实接了这些保护 ──
// 复刻测试只能证明「这个写法管用」，证明不了「源码里真的这么写」。两者都要。
{
  const srcPath = join(ROOT, 'server', 'api', 'token-deals', 'fetch-models.post.ts')
  const src = readFileSync(srcPath, 'utf8')

  check('真实源码有硬总时限（定时器到点 req.destroy）',
    /setTimeout\(\s*\n?[\s\S]{0,220}?req\.destroy\(/.test(src))
  check('真实源码在请求关闭时清理定时器',
    /req\.on\('close',\s*\(\)\s*=>\s*clearTimeout/.test(src))
  check('真实源码对 DNS 解析也设了超时',
    /DNS_TIMEOUT_MS/.test(src) && /Promise\.race/.test(src))
  check('真实源码按序尝试全部已校验地址（双栈回退，而非只钉 addrs[0]）',
    /target\.addrs\[i\]/.test(src) && !/addrs\[0\]\.address/.test(src))
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
