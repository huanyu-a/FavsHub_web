#!/usr/bin/env node
/**
 * mock-onebot.cjs — OneBot 11 HTTP API 本地模拟器（无依赖，node 直跑）
 *
 * 用途：本地开发时替代 NapCat，接收 favshub 应用的出站通知并打印日志。
 *
 * 与 NapCat 的对接说明（NapCat 侧配置）：
 *   1. NapCat「HTTP 服务器」端口      ↔ 本模拟器监听端口（MOCK_PORT，默认 5701）
 *      —— 应用通过 NUXT_QQ_BOT_HTTP_URL（如 http://127.0.0.1:5701）调
 *         POST /send_group_msg、POST /send_private_msg；
 *   2. NapCat「HTTP 上报地址」        ↔ http://<应用主机>:<应用端口>/api/bot/onebot
 *      —— NapCat 把收到的 QQ 消息 POST 上报到应用入站端点；
 *   3. access_token 两边一致          ↔ 应用 NUXT_QQ_BOT_ACCESS_TOKEN = 本脚本 TOKEN = NapCat token。
 *
 * 环境变量：
 *   MOCK_PORT  监听端口（默认 5701）
 *   TOKEN      access_token（默认空 = 不校验）
 *
 * 接口：
 *   POST /send_group_msg   { group_id, message }   —— 应用出站群消息
 *   POST /send_private_msg { user_id, message }    —— 应用出站私聊消息
 *   GET  /messages                                     —— 返回最近收到的消息（人工检查用）
 *
 * 内存保留最近 200 条；进程重启即清空。
 */
const http = require('node:http')

const PORT = Number(process.env.MOCK_PORT || 5701)
const TOKEN = String(process.env.TOKEN || '')

// ANSI 颜色
const C = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
}

/** 最近收到的消息（最多 200 条，新的在后） */
const messages = []
const MAX_MESSAGES = 200

function record(entry) {
  messages.push(entry)
  if (messages.length > MAX_MESSAGES) messages.shift()
}

/** 校验 Authorization: Bearer <token> */
function checkAuth(req, res) {
  if (!TOKEN) return true
  const header = String(req.headers['authorization'] || '')
  if (header === `Bearer ${TOKEN}`) return true
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: 'failed', retcode: 401, message: 'access_token 无效' }))
  return false
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function handleSend(kind, payload) {
  const now = new Date().toISOString()
  const entry = { at: now, kind, ...payload }
  record(entry)
  if (kind === 'group') {
    console.log(`${C.dim(now)} ${C.cyan(`[群 ${payload.group_id}]`)} ${String(payload.message ?? '')}`)
  } else {
    console.log(`${C.dim(now)} ${C.magenta(`[私聊 ${payload.user_id}]`)} ${String(payload.message ?? '')}`)
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  try {
    if (req.method === 'POST' && (url.pathname === '/send_group_msg' || url.pathname === '/send_private_msg')) {
      if (!checkAuth(req, res)) return
      const payload = await readBody(req)
      const kind = url.pathname === '/send_group_msg' ? 'group' : 'private'
      handleSend(kind, payload)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // OneBot 11 标准回包
      res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: Date.now() } }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/messages') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ total: messages.length, messages }, null, 2))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'failed', retcode: 404, message: 'not found' }))
  } catch (err) {
    console.error(C.red(`[mock-onebot] 处理请求失败: ${err.message}`))
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'failed', retcode: 400, message: err.message }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(C.green(`[mock-onebot] OneBot 模拟器已启动 http://127.0.0.1:${PORT}`))
  console.log(C.yellow(`  · 应用侧配置 NUXT_QQ_BOT_HTTP_URL=http://127.0.0.1:${PORT}`))
  console.log(C.yellow(`  · access_token：${TOKEN ? '已设置（出站请求需携带 Bearer ' + TOKEN + '）' : '未设置（不校验）'}`))
  console.log(C.yellow(`  · NapCat「HTTP 上报地址」填 http://<应用主机>:<应用端口>/api/bot/onebot`))
  console.log(C.yellow(`  · 查看/清理收到的消息：GET http://127.0.0.1:${PORT}/messages`))
})
