#!/usr/bin/env node
/**
 * scripts/lib/free-port.test.mjs — `free-port.mjs` 的单测 + 竞态真实验证
 *
 * ⚠️ 这个文件**不在** `assertion-count.mjs` 的门禁清单里（那需要改 assertion-count.mjs，
 *    而本轮改动的约束是不碰它）。它是一个可重复执行的单元测试，用 `node` 直接跑：
 *
 *      node scripts/lib/free-port.test.mjs
 *      node scripts/lib/free-port.test.mjs <被占用的端口>     # 额外跑「真实占端口 → 换端口重试」
 *
 * 覆盖：
 *   ① 判据 `isPortConflictError` 的正例 / **反例**（反例是关键：ABI 不匹配、未就绪、
 *      ECONNREFUSED 这些**不能**被误判成端口冲突，否则会白白重试 5 次并掩盖真实病因）
 *   ② `startWithFreePort` 的四条行为：首次成功 / 非冲突错误立刻抛 / 冲突换端口重试 / 次数用尽
 *   ③ 真起子进程 bind 端口：
 *        · 场景 C：脚本自己拉一个**独立占位进程**占住端口（也可用 argv[2] 指定外部占位端口）
 *          → 第一次真 EADDRINUSE → 换端口成功
 *        · 场景 D：不注入端口来源（走真实 pickFreePort），在 start 里把刚选到的端口抢走 →
 *          子进程真 EADDRINUSE → 换端口成功
 *
 * 断言数固定 19（不依赖外部环境），可直接挂进门禁：
 *   `node scripts/lib/free-port.test.mjs` → 19 通过 / 0 失败，exit 0。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import { pickFreePort, isPortConflictError, startWithFreePort } from './free-port.mjs'

let pass = 0
const fails = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fails.push(`${name} — ${e?.message || e}`); console.error(`  ✗ ${name} — ${e?.message || e}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 真起一个**子进程**去 bind 端口 —— 复刻套件里 `startApp` 的形状：
 * 失败时抛出的 Error.message 里带着子进程日志（EADDRINUSE 来自真实 OS，不是编的）。
 */
function spawnListener(port, holdMs = 400) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `
      const net = require('net')
      const srv = net.createServer()
      srv.on('error', (e) => { console.error('BIND_FAIL ' + e.message); process.exit(3) })
      srv.listen(${port}, '127.0.0.1', () => {
        console.log('LISTENING ${port}')
        setTimeout(() => process.exit(0), ${holdMs})
      })
    `], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('exit', (code) => {
      if (out.includes('LISTENING')) resolve({ port, out, code })
      else reject(new Error(`应用启动即退出（code=${code}）：\n${out}`))
    })
  })
}

// ─────────────────────────────────────────────────────────────
console.log('\n▶ ① 判据 isPortConflictError（正例 + 反例）')
// ─────────────────────────────────────────────────────────────
await t('真实 OS 的 EADDRINUSE（同一个端口 bind 两次）判为冲突', async () => {
  const a = createServer()
  await new Promise((res, rej) => { a.once('error', rej); a.listen(0, '127.0.0.1', res) })
  const port = a.address().port
  const b = createServer()
  const err = await new Promise((res) => { b.once('error', res); b.listen(port, '127.0.0.1', () => res(null)) })
  a.close(); b.close()
  assert.ok(err, '第二次 bind 竟然成功了 —— 测试前提不成立')
  assert.match(err.message, /EADDRINUSE/)
  assert.equal(isPortConflictError(err), true)
})

await t('子进程日志里的 listen EADDRINUSE 判为冲突', () => {
  assert.equal(isPortConflictError(
    '应用启动即退出（code=1）：\nError: listen EADDRINUSE: address already in use 127.0.0.1:3262\n    at Server.setupListenHandle'
  ), true)
})

await t('本仓库 waitPortFree 的中文诊断判为冲突', () => {
  assert.equal(isPortConflictError('端口 3262 仍被占用（上一次启动的实例没退干净）'), true)
  assert.equal(isPortConflictError('端口 3210 仍被占用（残留实例）'), true)
})

await t('Windows 文案（Only one usage of each socket address）判为冲突', () => {
  assert.equal(isPortConflictError(
    'Error: listen EADDRINUSE: address already in use :::3210\n  code: \'EADDRINUSE\'\n  Only one usage of each socket address (protocol/network address/port) is normally permitted'
  ), true)
})

await t('{ ok:false, evidence } / { logs } 形状也能取到证据', () => {
  assert.equal(isPortConflictError({ ok: false, evidence: 'listen EADDRINUSE' }), true)
  assert.equal(isPortConflictError({ ok: false, logs: ['EADDRINUSE'] }), true)
})

// ↓↓↓ 反例：这些**绝不能**被判成端口冲突，否则会把真实病因掩盖成 5 次重试
await t('反例：better-sqlite3 ABI 不匹配 → 不是端口冲突', () => {
  assert.equal(isPortConflictError(
    'better-sqlite3 无法在当前 node v24 下加载：\nError: The module was compiled against a different Node.js version using NODE_MODULE_VERSION 115'
  ), false)
})

await t('反例：应用 40s 内未就绪 → 不是端口冲突', () => {
  assert.equal(isPortConflictError('应用 40s 内未就绪'), false)
})

await t('反例：ECONNREFUSED（对端没起来）→ 不是端口冲突', () => {
  assert.equal(isPortConflictError('Error: connect ECONNREFUSED 127.0.0.1:3262'), false)
})

await t('反例：EACCES（权限）→ 不是端口冲突（重试也没用）', () => {
  assert.equal(isPortConflictError('Error: listen EACCES: permission denied 0.0.0.0:80'), false)
})

await t('反例：空证据 / undefined / 普通对象 → false（没有证据就不当冲突）', () => {
  assert.equal(isPortConflictError(), false)
  assert.equal(isPortConflictError(''), false)
  assert.equal(isPortConflictError(undefined, null), false)
  assert.equal(isPortConflictError({ ok: false }), false)
})

// ─────────────────────────────────────────────────────────────
console.log('\n▶ ② startWithFreePort 行为')
// ─────────────────────────────────────────────────────────────
const seqPicker = (ports) => { let i = 0; return async () => ports[Math.min(i++, ports.length - 1)] }

await t('首次成功：只在选到的端口上起一次，原样返回 start 的返回值', async () => {
  const seen = []
  const out = await startWithFreePort(async (port) => { seen.push(port); return { logs: ['ok'], port } }, { attempts: 5 })
  assert.equal(seen.length, 1)
  assert.ok(Number.isInteger(seen[0]) && seen[0] > 0)
  assert.equal(out.port, seen[0])
})

await t('非端口冲突错误：立刻抛，**只尝试一次**（不空转 attempts 次超时）', async () => {
  let calls = 0
  const t0 = Date.now()
  await assert.rejects(
    () => startWithFreePort(async () => { calls++; throw new Error('NODE_MODULE_VERSION 115 / 127 不匹配') }, { attempts: 5 }),
    /NODE_MODULE_VERSION/,
  )
  assert.equal(calls, 1)
  assert.ok(Date.now() - t0 < 2000, '不该有等待/重试')
})

await t('纯 false 返回（无证据）→ 立刻抛，只尝试一次', async () => {
  let calls = 0
  await assert.rejects(() => startWithFreePort(async () => { calls++; return false }, { attempts: 5 }), /返回失败/)
  assert.equal(calls, 1)
})

await t('bool 形状 { ok:false, evidence: "EADDRINUSE…" } → 换端口重试并成功', async () => {
  const seen = []
  const out = await startWithFreePort(async (port) => {
    seen.push(port)
    if (seen.length === 1) return { ok: false, evidence: '应用启动即退出（code=1）：\nError: listen EADDRINUSE: address already in use' }
    return true
  }, { attempts: 3 })
  assert.equal(out, true)
  assert.equal(seen.length, 2)
  assert.notEqual(seen[0], seen[1])
})

await t('冲突且次数用尽 → 抛出最后一次的错误，尝试次数恰好 = attempts', async () => {
  let calls = 0
  await assert.rejects(
    () => startWithFreePort(async () => { calls++; throw new Error('listen EADDRINUSE: address already in use') }, { attempts: 3 }),
    /EADDRINUSE/,
  )
  assert.equal(calls, 3)
})

await t('onRetry 收到 {attempt, port, nextPort, tried, error}，且每次换的端口都不同', async () => {
  const infos = []
  let calls = 0
  await startWithFreePort(async () => {
    calls++
    if (calls <= 2) throw new Error('listen EADDRINUSE: address already in use')
    return 'ok'
  }, { attempts: 3, onRetry: (info) => { infos.push(info) } })
  assert.equal(infos.length, 2)
  assert.deepEqual(infos.map((i) => i.attempt), [1, 2])
  assert.equal(infos[0].port, infos[0].tried[0])
  assert.notEqual(infos[0].port, infos[0].nextPort)
  assert.equal(infos[0].nextPort, infos[1].port)
  assert.match(String(infos[0].error?.message), /EADDRINUSE/)
})

await t('pickFreePort 返回的端口当下确实可用（能真的 bind）', async () => {
  for (let i = 0; i < 5; i++) {
    const port = await pickFreePort()
    const srv = createServer()
    await new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, '127.0.0.1', res) })
    assert.equal(srv.address().port, port)
    await new Promise((res) => srv.close(res))
  }
})

// ─────────────────────────────────────────────────────────────
console.log('\n▶ ③ 竞态真实验证（真子进程 bind 真端口）')
// ─────────────────────────────────────────────────────────────
const busyPortArg = Number(process.argv[2] || 0)

/**
 * 起一个**真实的独立进程**占住端口（就是任务要求的
 * `node -e "require('net').createServer().listen(<port>)"` 那种形状，
 * 只是由脚本自己拉起、跑完再收）—— 返回 { port, stop() }。
 */
async function spawnSquatter(port) {
  const child = spawn(process.execPath, ['-e',
    `require('net').createServer().listen(${port}, '127.0.0.1', () => console.log('SQUATTING ${port}'))`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  const t0 = Date.now()
  while (!out.includes('SQUATTING')) {
    if (Date.now() - t0 > 5000) { child.kill('SIGKILL'); throw new Error(`占位进程没起来：${out}`) }
    await sleep(50)
  }
  return { port, stop: () => new Promise((res) => { child.once('exit', res); child.kill('SIGKILL') }) }
}

// 有外部进程占着 argv[2] 就用它；否则自己拉一个真实占位进程 ——
// 两条路径下这条用例都**必然**执行，断言数固定，方便挂进门禁。
const squatter = busyPortArg ? { port: busyPortArg, stop: async () => {} } : await spawnSquatter(await pickFreePort())
const busyPort = squatter.port
{
  await t(`场景 C：外部进程占着 ${busyPort} → 第一次真 EADDRINUSE → 换端口起成功`, async () => {
    // 先确认外部占位进程真的在（否则这个场景是假的）
    const probe = createServer()
    const probeErr = await new Promise((res) => { probe.once('error', res); probe.listen(busyPort, '127.0.0.1', () => res(null)) })
    probe.close()
    assert.ok(probeErr, `端口 ${busyPort} 其实是空闲的 —— 占位进程没起来`)
    assert.match(probeErr.message, /EADDRINUSE/)

    const seen = []
    const infos = []
    // 端口来源：第一次故意给「被占用的端口」（模拟内核把刚释放的号给了别的进程），之后走真实 pickFreePort
    let first = true
    const pick = async () => { if (first) { first = false; return busyPort } return await pickFreePort() }

    const out = await startWithFreePort(async (port) => { seen.push(port); return await spawnListener(port) },
      { attempts: 3, pickPort: pick, onRetry: (info) => infos.push(info) })

    assert.deepEqual(seen, [busyPort, out.port], `实际尝试端口序列 ${seen.join(',')}`)
    assert.equal(seen.length, 2, '应该恰好换一次端口')
    assert.notEqual(out.port, busyPort)
    assert.equal(infos.length, 1)
    assert.equal(infos[0].port, busyPort)
    assert.equal(infos[0].nextPort, out.port)
    assert.equal(isPortConflictError(infos[0].error), true)
    assert.match(String(infos[0].error?.message), /EADDRINUSE/)
    console.log(`     第一次 EADDRINUSE 的证据：${String(infos[0].error?.message).split('\n').filter(Boolean).slice(0, 2).join(' / ')}`)
    console.log(`     换到端口 ${out.port} 后子进程日志：${out.out.trim()}`)
  })
}
await squatter.stop()

await t('场景 D：不注入端口来源（真实 pickFreePort）—— 在 start 里把刚选到的端口抢走 → 真 EADDRINUSE → 换端口成功', async () => {
  const holder = createServer()
  const seen = []
  const infos = []
  let stolen = null
  const out = await startWithFreePort(async (port) => {
    seen.push(port)
    if (stolen === null) {
      // 复刻「选到端口 → 应用真正 listen」之间被别人抢走：我们自己抢
      stolen = port
      await new Promise((res, rej) => { holder.once('error', rej); holder.listen(port, '127.0.0.1', res) })
    }
    return await spawnListener(port)
  }, { attempts: 3, onRetry: (info) => infos.push(info) })
  await new Promise((res) => holder.close(res))

  assert.equal(seen.length, 2, `应该恰好换一次端口（实际 ${seen.join(',')}）`)
  assert.equal(seen[0], stolen)
  assert.notEqual(out.port, stolen)
  assert.equal(isPortConflictError(infos[0].error), true)
  assert.match(String(infos[0].error?.message), /BIND_FAIL.*EADDRINUSE/s)
  console.log(`     抢走的端口 ${stolen} → 子进程真实报错；换到 ${out.port} 后：${out.out.trim()}`)
})

await sleep(50)
console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败（free-port 单测 + 竞态真实验证）═══`)
if (fails.length) {
  console.error('失败项：')
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
