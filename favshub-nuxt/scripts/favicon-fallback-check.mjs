#!/usr/bin/env node
/**
 * favicon-fallback-check.mjs — 公共域名取图失败时的站内通用图标回退契约。
 *
 * 使用真实 Nitro + 临时 SQLite + 临时 .output 快照。将取图源指向回环 refused 端口，
 * 让 SSRF 护栏在临时环境内确定性地拒绝下载，不访问生产或公网。
 *
 * 前置：已存在 .output。用法：node scripts/favicon-fallback-check.mjs
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWithFreePort } from './lib/free-port.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const requireFromRoot = createRequire(join(ROOT, 'package.json'))
const Database = requireFromRoot('better-sqlite3')
const TMP = mkdtempSync(join(tmpdir(), 'favshub-favicon-fallback-'))
const SNAP = join(TMP, 'output')
const DB_PATH = join(TMP, 'test.db')
const FALLBACK = '/images/favicon-fallback.svg'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let appProcess = null
let base = ''
let passed = 0
let failed = 0

function check(description, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ✓ ${description}`)
  } else {
    failed++
    console.error(`  ✗ ${description}${detail ? ` — ${detail}` : ''}`)
  }
}

async function request(path) {
  const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  return { response, text: await response.text() }
}

async function stopApp() {
  const proc = appProcess
  if (!proc) return
  appProcess = null
  const exited = new Promise(resolve => proc.once('exit', resolve))
  proc.kill('SIGTERM')
  await Promise.race([exited, sleep(4000)])
  try { proc.kill('SIGKILL') } catch { /* already exited */ }
  await Promise.race([exited, sleep(1000)])
}

async function startOnce(port) {
  base = `http://127.0.0.1:${port}`
  const logs = []
  const child = spawn(process.execPath, [join(SNAP, 'server', 'index.mjs')], {
    cwd: SNAP,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      NUXT_DB_PATH: DB_PATH,
      FAVICON_DATA_DIR: join(TMP, 'favicon-data'),
      NUXT_JWT_SECRET: randomBytes(32).toString('hex'),
      NUXT_TRUST_PROXY: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  appProcess = child
  child.stdout.on('data', chunk => logs.push(String(chunk)))
  child.stderr.on('data', chunk => logs.push(String(chunk)))
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`应用启动退出：${logs.join('').slice(-1500)}`)
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return
    } catch { /* not ready */ }
    await sleep(200)
  }
  throw new Error(`应用 30s 内未就绪：${logs.join('').slice(-1500)}`)
}

async function startApp() {
  await startWithFreePort(async port => {
    try { await startOnce(port) } catch (error) {
      await stopApp()
      throw error
    }
  }, { attempts: 5 })
}

async function waitForSchema() {
  let lastError = null
  for (let attempt = 0; attempt < 60; attempt++) {
    let db = null
    try {
      db = new Database(DB_PATH, { readonly: true })
      db.prepare('SELECT value FROM system_config LIMIT 1').get()
      db.close()
      return
    } catch (error) {
      lastError = error
      try { db?.close() } catch { /* ignore */ }
      await sleep(250)
    }
  }
  throw new Error(`临时库 15s 内未完成迁移：${lastError?.message || lastError}`)
}

async function main() {
  if (!existsSync(join(ROOT, '.output', 'server', 'index.mjs'))) {
    throw new Error('未找到 .output/server/index.mjs，请先 build')
  }
  cpSync(join(ROOT, '.output'), SNAP, { recursive: true })
  await startApp()
  await waitForSchema()

  const db = new Database(DB_PATH)
  db.prepare(`INSERT INTO system_config (key, value, updated_at) VALUES ('favicon_source_url', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run('http://127.0.0.1:1/{domain}', Date.now())
  db.close()

  const first = await request('/api/favicon?domain=no-icon.example')
  check('公共域名取图失败返回 302 而非控制台 404', first.response.status === 302, `status=${first.response.status}`)
  check('失败重定向指向站内通用图标', first.response.headers.get('location') === FALLBACK,
    `location=${first.response.headers.get('location')}`)
  check('回退重定向带 1 小时公共缓存', String(first.response.headers.get('cache-control')).includes('max-age=3600'),
    `cache-control=${first.response.headers.get('cache-control')}`)

  const icon = await request(FALLBACK)
  check('通用图标可读取且为 SVG', icon.response.status === 200 && String(icon.response.headers.get('content-type')).includes('image/svg+xml'),
    `status=${icon.response.status} content-type=${icon.response.headers.get('content-type')}`)
  check('通用图标包含安全静态 SVG 根元素', icon.text.includes('<svg') && !icon.text.includes('<script'))

  const repeated = await request('/api/favicon?domain=no-icon.example')
  check('失败域名短缓存重复请求仍回退而非 404', repeated.response.status === 302 && repeated.response.headers.get('location') === FALLBACK,
    `status=${repeated.response.status} location=${repeated.response.headers.get('location')}`)

  const privateHost = await request('/api/favicon?domain=localhost')
  check('私有域名仍被 400 拒绝且不回退', privateHost.response.status === 400, `status=${privateHost.response.status}`)
  const missing = await request('/api/favicon')
  check('缺 domain 参数仍被 400 拒绝', missing.response.status === 400, `status=${missing.response.status}`)

  console.log(`\n═══ 结果：${passed} 通过，${failed} 失败 ═══`)
  if (failed) process.exitCode = 1
}

try {
  await main()
} catch (error) {
  failed++
  console.error(`✗ 执行异常：${error?.stack || error}`)
  process.exitCode = 1
} finally {
  await stopApp()
  rmSync(TMP, { recursive: true, force: true })
  console.log(`  · 临时目录已删除：${!existsSync(TMP)}`)
}
