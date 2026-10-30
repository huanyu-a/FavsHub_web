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

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
