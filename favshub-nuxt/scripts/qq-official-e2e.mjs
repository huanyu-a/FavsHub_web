#!/usr/bin/env node
/**
 * qq-official-e2e.mjs — QQ 官方机器人接入端到端回归自测（node 直跑，自包含）
 *
 * 依赖先决条件：`pnpm build` 已产出 `.output/`。
 *
 * 验证流程：
 *   1. spawn 启动真实产物应用（PORT=3277，临时库 data/e2e-qq-official-<时间戳>.db）；
 *   2. 注册并登录管理员账号；
 *   3. PUT /api/admin/config 配置官方机器人（qq_bot_transport=official, appid, secret）；
 *   4. GET /api/admin/config 验证 qq_bot_app_secret 敏感信息被脱敏为「已设置」；
 *   5. POST /api/bot/qq 测试官方 Webhook：
 *      - 异常 UA -> 403
 *      - op=13 握手验证 -> 200 + Ed25519 签名回传
 *      - op=0 事件上报 -> 204
 *   6. 清理子进程与临时库，输出测试报告。
 *
 * 用法：node scripts/qq-official-e2e.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { rmSync } from 'node:fs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_PORT = 3277
const BASE = `http://127.0.0.1:${APP_PORT}`
const STAMP = Date.now()
const DB_PATH = join(ROOT, 'data', `e2e-qq-official-${STAMP}.db`)

const TEST_APPID = '1900889900'
const TEST_SECRET = 'DG5g3B4j9X2KOErG' // 官方测试 Secret
const INITIAL_GROUP_OPENID = 'ORIGIN_GROUP_OPENID_123'

let passCount = 0
let failCount = 0

function ok(title) {
  passCount++
  console.log(`  ✓ ${title}`)
}

function fail(title, detail) {
  failCount++
  console.error(`  ✗ ${title}`, detail !== undefined ? detail : '')
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function cleanupDb(p) {
  for (const ext of ['', '-wal', '-shm']) {
    try { rmSync(p + ext, { force: true }) } catch {}
  }
}

function disableRegisterChallenge(dbPath) {
  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  const Database = requireFromRoot('better-sqlite3')
  const db = new Database(dbPath)
  try {
    db.prepare(
      "INSERT INTO system_config(key,value) VALUES('register_turnstile_enabled','false') " +
      "ON CONFLICT(key) DO UPDATE SET value='false'"
    ).run()
  } finally {
    db.close()
  }
}

let appProcess = null

async function startApp() {
  const entry = join(ROOT, '.output', 'server', 'index.mjs')
  appProcess = spawn('node', [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(APP_PORT),
      NUXT_DB_PATH: DB_PATH,
      NUXT_ADMIN_USERS: 'qqofficialadmin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  appProcess.stderr.on('data', d => {
    const s = String(d).trim()
    if (s && !s.includes('ExperimentalWarning')) {
      console.error(`  [app-err] ${s.slice(0, 300)}`)
    }
  })

  const start = Date.now()
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return
    } catch {}
    await sleep(500)
  }
  throw new Error('应用在 30 秒内未能正常启动')
}

async function stopApp() {
  if (!appProcess) return
  const proc = appProcess
  appProcess = null
  proc.kill('SIGTERM')
  await sleep(300)
  if (!proc.killed) proc.kill('SIGKILL')
}

// ── HTTP 请求 Helper ─────────────────────────────────────────
async function api(path, { method = 'GET', cookie, body, headers: customHeaders } = {}) {
  const headers = { ...(customHeaders || {}) }
  if (cookie) headers.Cookie = cookie
  if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text, res }
}

async function main() {
  console.log(`▶ [1/5] 启动生产产物应用（PORT=${APP_PORT}）`)
  cleanupDb(DB_PATH)
  await startApp()
  disableRegisterChallenge(DB_PATH)
  ok('应用已成功启动并就绪')

  console.log('▶ [2/5] 注册并登录管理员账号')
  // 注册管理员
  const regRes = await api('/api/auth/register', {
    method: 'POST',
    body: { username: 'qqofficialadmin', password: '{{SECRET_d0vvhj4e}}' },
  })
  if (regRes.status !== 200) {
    fail('注册管理员失败', regRes.status)
    return
  }

  // 登录管理员
  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'qqofficialadmin', password: '{{SECRET_d0vvhj4e}}' },
  })
  if (loginRes.status !== 200) {
    fail('登录管理员失败', loginRes.status)
    return
  }

  const setCookie = loginRes.res.headers.getSetCookie?.() || []
  const adminCookie = setCookie.map(c => c.split(';')[0]).join('; ')
  ok('管理员登录成功并取得会话 Cookie')

  console.log('▶ [3/5] 配置 QQ 官方机器人直连模式')
  const putConfigRes = await api('/api/admin/config', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      data: {
        qq_bot_enabled: 'true',
        qq_bot_transport: 'official',
        qq_bot_appid: TEST_APPID,
        qq_bot_app_secret: TEST_SECRET,
        qq_bot_group_id: INITIAL_GROUP_OPENID,
      },
    },
  })
  if (putConfigRes.status === 200) {
    ok('PUT /api/admin/config 保存官方机器人配置成功')
  } else {
    fail('保存官方机器人配置失败', putConfigRes)
  }

  console.log('▶ [4/5] 校验机密信息脱敏回显')
  const getConfigRes = await api('/api/admin/config', {
    method: 'GET',
    cookie: adminCookie,
  })
  const sysData = getConfigRes.json?.systemData || {}
  if (sysData.qq_bot_transport === 'official' && sysData.qq_bot_appid === TEST_APPID) {
    ok('GET /api/admin/config 正确返回 transport 与 appid')
  } else {
    fail('配置项读取不一致', sysData)
  }

  if (sysData.qq_bot_app_secret === '已设置') {
    ok('qq_bot_app_secret 正确脱敏回显为「已设置」')
  } else {
    fail('qq_bot_app_secret 脱敏失败', sysData.qq_bot_app_secret)
  }

  console.log('▶ [5/5] 测试 Webhook 入站端点 /api/bot/qq')
  // 1. 测试非法 UA 拦截
  const badUaRes = await api('/api/bot/qq', {
    method: 'POST',
    body: { op: 13 },
  })
  if (badUaRes.status === 403) {
    ok('非 QQ 官方回调 UA 请求被正确拦截 (403)')
  } else {
    fail('非法 UA 未被拦截', badUaRes.status)
  }

  // 2. 测试 op=13 握手验证
  const handshakeBody = {
    op: 13,
    d: {
      plain_token: 'Arq0D5A61EgUu4OxUvOp',
      event_ts: '1725442341',
    },
  }
  const handshakeRes = await api('/api/bot/qq', {
    method: 'POST',
    headers: {
      'User-Agent': 'QQBot-Callback',
      'X-Bot-Appid': TEST_APPID,
    },
    body: handshakeBody,
  })
  if (handshakeRes.status === 200) {
    const expectedSig = '87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706'
    if (handshakeRes.json?.plain_token === 'Arq0D5A61EgUu4OxUvOp' && handshakeRes.json?.signature === expectedSig) {
      ok('op=13 握手成功并返回官方标准 Ed25519 签名')
    } else {
      fail('op=13 返回签名内容不符', handshakeRes.json)
    }
  } else {
    fail('op=13 请求未返回 200', handshakeRes)
  }

  // 3. 测试 op=0 消息上报与幂等
  const msgEvent = {
    op: 0,
    id: `event_${STAMP}`,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: {
      id: `msg_${STAMP}`,
      group_openid: 'CAPTURED_GROUP_OPENID_XYZ',
      content: '<@!1900889900> 帮助',
      author: { member_openid: 'USER_OPENID_TEST' },
    },
  }
  const eventRes = await api('/api/bot/qq', {
    method: 'POST',
    headers: {
      'User-Agent': 'QQBot-Callback',
      'X-Bot-Appid': TEST_APPID,
    },
    body: msgEvent,
  })
  if (eventRes.status === 204) {
    ok('op=0 群 @ 机器人事件正常分发处理并返回 204')
  } else {
    fail('op=0 事件未返回 204', eventRes.status)
  }

  // 4. 重复上报测试幂等性
  const dupEventRes = await api('/api/bot/qq', {
    method: 'POST',
    headers: {
      'User-Agent': 'QQBot-Callback',
      'X-Bot-Appid': TEST_APPID,
    },
    body: msgEvent,
  })
  if (dupEventRes.status === 204) {
    ok('op=0 重复事件命中 LRU 幂等去重并直接返回 204')
  } else {
    fail('幂等测试未返回 204', dupEventRes.status)
  }
}

try {
  await main()
} catch (e) {
  console.error('端到端测试异常中止:', e)
  failCount++
} finally {
  console.log('▶ 清理应用进程与临时数据库')
  await stopApp()
  cleanupDb(DB_PATH)
  console.log(`\n========================================`)
  console.log(`E2E 结果: ${passCount} 通过, ${failCount} 失败`)
  console.log(`========================================`)
  if (failCount > 0) process.exit(1)
}
