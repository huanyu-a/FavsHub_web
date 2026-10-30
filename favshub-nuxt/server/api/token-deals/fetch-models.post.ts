/**
 * POST /api/token-deals/fetch-models — 从通告的 API 地址拉取模型列表（2026-10-30）
 *
 * Body: `{ call_url: string, api_key?: string }`
 *
 * 需求原文：「支持模型：内置 /v1/model 接口，可直接通过接口来获取模型，然后手动点击选择；
 * 部分平台需要 key 来鉴权，到时候可出现 key 字段，待填了 key 后再获取模型」。
 *
 * ## 这是本站极少数的「服务端主动出站」接口 —— SSRF 是首要风险
 *
 * 入参里的 `call_url` 是**用户可控的任意 URL**，服务端会去请求它。
 * 若不做防护，任何人都能拿本站当跳板探测内网 / 云元数据（`169.254.169.254`）。
 *
 * 防护分四层，**第 3 层是 2026-10-30 审查后补的，也是最关键的一层**：
 *   1. **协议与主机名**：仅 http/https；拒绝 `localhost`、`*.internal`、内网 IP 字面量；
 *      拒绝 URL 内嵌 `user:pass@`；
 *   2. **DNS 解析结果校验**：解析出的每个 IP 都过 `isPrivateIP`（挡 `evil.com` → `127.0.0.1`）；
 *   3. **把校验过的 IP 钉死到连接**（`lookup` 回调直接喂已校验地址）；
 *   4. **不自动跟随重定向**：手动跟一跳并**重新做完整校验**。
 *
 * 第 3 层为什么必须有：`fetch` 只会拿到主机名，然后**自己再解析一次** DNS。
 * 于是「我们校验的 IP」与「它实际连的 IP」可以是两个不同地址 ——
 * 只要攻击者的权威 DNS 在两次查询之间换答案（TTL=0 轮询、fake-ip 模式等），
 * 第 2 层就形同虚设，实测可直接读到内网数据。把地址通过 `lookup` 回调
 * 交给底层 socket，校验值与连接值才必然同一个（TOCTOU 收口）。
 *
 * ## 其它边界
 *
 * - 响应体上限 2 MB，**边读边累计、超限立即 destroy**（不是读完再判 —— 那等于没上限）
 * - 整个「含重定向」流程共享一个 12 秒 deadline，不是每跳各给 12 秒
 * - `api_key` **只用于本次出站请求**，不落库、不回显、不写日志
 *
 * ## 限频
 *
 * 登录用户按 用户+IP 计数（30/小时）；游客按 IP 计数（6/小时）。
 * 游客也放行是为了不砍掉「游客投稿」这条通道，但额度压得很低 ——
 * 即使被滥用，也只是一台「每小时最多出站 6 次」的受限代理。
 */
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns/promises'
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import { isPrivateHostname, isPrivateIP } from '../../utils/favicon-download'

/** 响应体上限：模型清单是纯文本，2 MB 已经非常宽松 */
const MAX_BODY_BYTES = 2 * 1024 * 1024
/** 出站超时：**整个流程**（含重定向）共享，不是每跳各一份 */
const FETCH_TIMEOUT_MS = 12_000
/** 最多跟随一跳重定向（够覆盖 http→https），且每跳重新校验 */
const MAX_REDIRECTS = 1
/** 返回给前端的模型数量上限 */
const MAX_MODELS = 500
/** 单个模型 ID 长度上限（正常几十字符，留足冗余） */
const MAX_MODEL_NAME = 120

const MODEL_FETCH_PER_USER_PER_HOUR = 30
const MODEL_FETCH_PER_GUEST_IP_PER_HOUR = 6

/**
 * 出站相关的可预期错误：带明确的 HTTP 状态码，
 * 免得下游靠 `msg.includes('内网')` 这种字符串匹配来分流（脆弱且易漏）。
 */
class OutboundError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'OutboundError'
    this.statusCode = statusCode
  }
}

/**
 * 把用户填的 API 地址规整成「模型清单端点」。
 *
 * 规则（按用户真实填法归纳）：
 *   - `https://api.x.com/v1/models` → 原样
 *   - `https://api.x.com/v1`        → 补 `/models`
 *   - `https://api.x.com`           → 补 `/v1/models`
 *   - `https://api.x.com/`          → 去尾斜杠后同上
 *
 * **只在 `pathname` 上拼接**：直接对整串做字符串相加会把 `/v1/models` 塞进 query
 * （`https://x/v1?k=1` → `?k=1/v1/models`），Azure 的 `?api-version=` 也会被弄乱。
 */
export function normalizeModelsEndpoint(input: string): string {
  const raw = input.trim()
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    // 格式问题交给下游的解析校验统一报错，这里原样返回
    return raw
  }

  let path = u.pathname.replace(/\/+$/, '')
  if (!/\/models$/i.test(path)) {
    // `/v1`、`/v2`、`/v1beta`（Gemini 风格）都算版本段
    path = /\/v\d+(?:beta\d*)?$/i.test(path) ? `${path}/models` : `${path}/v1/models`
  }
  u.pathname = path
  return u.href
}

/** 校验并解析出可安全连接的地址（**校验结果即连接目标**） */
async function resolveSafeTarget(urlStr: string): Promise<{ url: URL; address: string; family: number }> {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    throw new OutboundError('API 地址格式不正确')
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new OutboundError('API 地址仅支持 http/https')
  }
  if (u.username || u.password) {
    throw new OutboundError('API 地址不能内嵌账号密码')
  }
  if (isPrivateHostname(u.hostname)) {
    throw new OutboundError('不允许访问内网地址')
  }

  let addrs: Array<{ address: string; family: number }>
  try {
    addrs = await dns.lookup(u.hostname, { all: true }) as Array<{ address: string; family: number }>
  } catch {
    throw new OutboundError('域名解析失败，请检查 API 地址')
  }
  if (!addrs.length) throw new OutboundError('域名解析失败，请检查 API 地址')

  // **每一个**解析结果都必须干净 —— 只查第一个会被「先回公网、再回内网」绕开
  for (const a of addrs) {
    if (isPrivateIP(a.address)) throw new OutboundError('不允许访问内网地址')
  }

  // 取第一个作为固定连接目标（与 Node 默认行为一致，但地址已经过校验）
  return { url: u, address: addrs[0].address, family: addrs[0].family }
}

/** 用**已校验并钉死**的地址发起一次 GET */
function pinnedGet(
  target: { url: URL; address: string; family: number },
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; location: string | null; text: string }> {
  const mod = target.url.protocol === 'https:' ? https : http
  const port = target.url.port || (target.url.protocol === 'https:' ? 443 : 80)

  return new Promise((resolve, reject) => {
    const req = mod.request({
      protocol: target.url.protocol,
      hostname: target.url.hostname,
      port,
      path: target.url.pathname + target.url.search,
      method: 'GET',
      headers,
      // ── 关键：把已校验的地址直接喂给 socket ──
      // `fetch` 没有这个能力（它自己解析 DNS），所以这一层只能用原生 http 模块实现。
      // TLS 的 SNI 与证书校验仍基于 hostname，不受影响。
      //
      // 注意 `http.request` 内部是以 `{ all: true }` 调 lookup 的（实测 Node 24），
      // 此时回调必须给**数组**；给 `(err, address, family)` 会直接报
      // `Invalid IP address: undefined` 而连不上 —— 两个分支都要覆盖。
      lookup: (_hostname, options, cb) => {
        if (options && (options as any).all) {
          cb(null, [{ address: target.address, family: target.family }] as any)
        } else {
          cb(null, target.address, target.family)
        }
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        // 边读边判：读完再判等于没有上限（40 MB 响应会整块进内存）
        if (size > MAX_BODY_BYTES) {
          req.destroy(new OutboundError('目标站点响应体过大，已拒绝解析'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        location: (res.headers.location as string) || null,
        text: Buffer.concat(chunks).toString('utf8'),
      }))
      res.on('error', reject)
    })

    req.on('timeout', () => req.destroy(new OutboundError('目标站点响应超时，请稍后重试')))
    req.on('error', reject)
    req.end()
  })
}

/**
 * 带 SSRF 防护的 GET：手动处理重定向，每一跳都重新校验并重新钉地址。
 * 不返回 Response 对象，直接给出文本 —— 顺带把体积上限与超时收在这一个地方。
 */
async function safeGet(
  urlStr: string,
  headers: Record<string, string>,
  depth = 0,
  deadline = Date.now() + FETCH_TIMEOUT_MS,
): Promise<{ status: number; text: string }> {
  // 总 deadline 而非每跳各一份：否则 MAX_REDIRECTS 跳能把最坏耗时放大数倍
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new OutboundError('目标站点响应超时，请稍后重试')

  const target = await resolveSafeTarget(urlStr)
  const res = await pinnedGet(target, headers, remaining)

  if (res.status >= 300 && res.status < 400) {
    if (depth >= MAX_REDIRECTS) {
      throw new OutboundError('重定向次数超限，请直接填写最终地址')
    }
    if (!res.location) {
      throw new OutboundError(`HTTP ${res.status} 重定向缺少 Location`)
    }
    const next = new URL(res.location, target.url).href
    return safeGet(next, headers, depth + 1, deadline)
  }

  return { status: res.status, text: res.text }
}

/** 从各种 OpenAI 兼容 / 裸数组响应里抽出模型 ID 列表 */
export function extractModelIds(payload: any): string[] {
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : []

  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    const id = typeof item === 'string'
      ? item
      : String(item?.id ?? item?.name ?? item?.model ?? '').trim()
    if (!id || id.length > MAX_MODEL_NAME || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_MODELS) break
  }
  return out
}

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  const body = await readBody(event).catch(() => ({} as any))

  const callUrl = String(body?.call_url ?? body?.callUrl ?? '').trim()
  if (!callUrl) {
    throw createError({ statusCode: 400, data: { error: '请先填写 API 地址' } })
  }
  if (callUrl.length > 500) {
    throw createError({ statusCode: 400, data: { error: 'API 地址过长' } })
  }

  // API Key 只用于本次出站；长度做个上限，避免有人拿它当任意 header 注入载体
  const apiKey = String(body?.api_key ?? body?.apiKey ?? '').trim()
  if (apiKey.length > 300) {
    throw createError({ statusCode: 400, data: { error: 'API Key 过长' } })
  }
  // 防 header 注入：控制字符一律拒绝
  if (/[\r\n]/.test(apiKey)) {
    throw createError({ statusCode: 400, data: { error: 'API Key 含非法字符' } })
  }

  const ip = getClientIP(event)
  if (role) {
    checkRateLimit(
      `fetch_models:u${role.user.id}:${ip}`,
      MODEL_FETCH_PER_USER_PER_HOUR,
      3_600_000,
    )
  } else {
    checkRateLimit(
      `fetch_models:ip:${ip}`,
      MODEL_FETCH_PER_GUEST_IP_PER_HOUR,
      3_600_000,
    )
  }

  const endpoint = normalizeModelsEndpoint(callUrl)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'FavsHub-ModelFetch/1.0 (+https://hao.bx9y.com.cn)',
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  let res: { status: number; text: string }
  try {
    res = await safeGet(endpoint, headers)
  } catch (err: any) {
    // 一律不回显上游原始错误（可能含内网信息），只给可操作的提示。
    // 出站护栏自身抛的错带明确状态码，直接用；其余归为「连不上」。
    if (err instanceof OutboundError) {
      throw createError({ statusCode: err.statusCode, data: { error: err.message } })
    }
    throw createError({ statusCode: 502, data: { error: '无法连接到该地址，请检查 API 地址是否正确' } })
  }

  if (res.status === 401 || res.status === 403) {
    throw createError({
      statusCode: 400,
      data: { error: apiKey ? '鉴权失败：API Key 无效或权限不足' : '该平台需要鉴权，请先填写 API Key' },
    })
  }
  if (res.status === 404) {
    throw createError({ statusCode: 400, data: { error: '该地址没有模型清单接口（404），请检查 API 地址' } })
  }
  if (res.status !== 200) {
    // 上游 5xx 归为 400：这是「该地址不好用」的用户侧问题，
    // 报 502 会被全站错误处理器统一改写成「服务器内部错误」，提示反而丢失
    throw createError({ statusCode: 400, data: { error: `目标站点返回 HTTP ${res.status}，请检查 API 地址` } })
  }

  let payload: any
  try {
    payload = JSON.parse(res.text)
  } catch {
    throw createError({ statusCode: 400, data: { error: '响应不是 JSON，确认填写的是 API 地址而非网页地址' } })
  }

  const models = extractModelIds(payload)
  if (!models.length) {
    throw createError({
      statusCode: 400,
      data: { error: '该地址未返回任何模型，可能路径不对或需要鉴权' },
    })
  }

  return {
    code: 200,
    data: {
      endpoint,
      models,
      count: models.length,
      /** 响应被截断到上限时提示前端 */
      truncated: models.length >= MAX_MODELS,
    },
  }
})
