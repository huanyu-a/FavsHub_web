/**
 * QQ 机器人官方 OpenAPI 客户端（纯 Node 原生，零外部依赖）
 *
 * 规范参考：《QQ 机器人群通知完整技术栈 · 教学文档》与腾讯开放平台 2026 规范
 * - 统一基址：https://api.bot.qq.com
 * - 鉴权方式：Authorization: QQBot {access_token}
 * - Token 换取：POST /app/getAppAccessToken，内存缓存 7200 秒（提前 60s 刷新，带并发去重）
 * - 多目标与多机器人支持：
 *   - 目标规范化：自动剥离 qqbot: 前缀，忽略非 QQ 通道（如 dingtalk:），支持逗号/分号切分多群/多用户广播
 *   - 多机器人实例：按 appId 独立维护 Token 缓存与并发去重，支持配置单机器人或多机器人数组
 * - 群消息：POST /v2/groups/{group_openid}/messages（msg_type: 0 文本 / 2 markdown）
 * - 私聊消息：POST /v2/users/{openid}/messages
 * - 回调验签：Ed25519（Node 内置 crypto PKCS8 DER 签名）
 */
import crypto from 'node:crypto'
import { getConfig } from './config'

const BASE_URL = 'https://api.bot.qq.com'
const REQUEST_TIMEOUT_MS = 6000

export interface BotAccount {
  appId: string
  appSecret: string
  /** 该机器人绑定的群 openid 清单（可选，用于多机器人路由） */
  groups?: string[]
}

/** 内存中的 Token 缓存（按 appId 隔离） */
const tokenCacheMap = new Map<string, { token: string; expiresAt: number }>()
const tokenInflightMap = new Map<string, Promise<string | null>>()

/**
 * 读取官方机器人配置列表（支持单个配置或 JSON 多机器人数组配置）
 */
export function getOfficialBotAccounts(): BotAccount[] {
  let appIdRaw = String(getConfig('qq_bot_appid') || '').trim()
  let appSecretRaw = String(getConfig('qq_bot_app_secret') || '').trim()

  if (!appIdRaw || !appSecretRaw) {
    try {
      const rc = useRuntimeConfig()
      if (!appIdRaw) appIdRaw = String(rc.qqBotAppId || '').trim()
      if (!appSecretRaw) appSecretRaw = String(rc.qqBotAppSecret || '').trim()
    } catch { /* 无 runtimeConfig 环境 */ }
  }

  // 1. 尝试解析为 JSON 多机器人数组
  if (appIdRaw.startsWith('[') && appIdRaw.endsWith(']')) {
    try {
      const parsed = JSON.parse(appIdRaw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((item: any) => item && item.appId && item.appSecret)
          .map((item: any) => ({
            appId: String(item.appId).trim(),
            appSecret: String(item.appSecret).trim(),
            groups: Array.isArray(item.groups) ? item.groups.map(String) : undefined,
          }))
      }
    } catch { /* 不是合法 JSON，按单个处理 */ }
  }

  // 2. 默认单机器人
  if (appIdRaw && appSecretRaw) {
    return [{ appId: appIdRaw, appSecret: appSecretRaw }]
  }

  return []
}

/** 获取主机器人配置（兼容原有单机器人调用） */
export function getOfficialBotConfig(): { appId: string; appSecret: string } {
  const accounts = getOfficialBotAccounts()
  if (accounts.length > 0) {
    return { appId: accounts[0].appId, appSecret: accounts[0].appSecret }
  }
  return { appId: '', appSecret: '' }
}

/** 官方 OpenAPI 通道是否可用 */
export function isOfficialConfigured(): boolean {
  return getOfficialBotAccounts().length > 0
}

/**
 * 获取指定 appId 的 access_token（缓存 7200 秒，提前 60 秒刷新，按 appId 并发去重）
 */
export async function getOfficialAccessToken(targetAppId?: string): Promise<string | null> {
  const accounts = getOfficialBotAccounts()
  if (accounts.length === 0) {
    console.warn('[QQBot] 官方 OpenAPI 未配置 appId 或 appSecret')
    return null
  }

  const account = targetAppId
    ? accounts.find(a => a.appId === targetAppId) || accounts[0]
    : accounts[0]

  const { appId, appSecret } = account
  const now = Date.now()
  const cached = tokenCacheMap.get(appId)
  if (cached && now < cached.expiresAt) {
    return cached.token
  }

  const inflight = tokenInflightMap.get(appId)
  if (inflight) return inflight

  const promise = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/app/getAppAccessToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, clientSecret: appSecret }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error(`[QQBot] 获取 access_token 失败 [${appId}] HTTP ${res.status}: ${errText}`)
        return null
      }

      const data = await res.json().catch(() => null) as { access_token?: string; expires_in?: string | number } | null
      const token = data?.access_token
      if (!token) {
        console.error(`[QQBot] [${appId}] 响应中缺少 access_token 字段:`, data)
        return null
      }

      const expiresInSec = Number(data.expires_in ?? 7200)
      tokenCacheMap.set(appId, {
        token,
        expiresAt: now + Math.max(expiresInSec - 60, 60) * 1000,
      })
      return token
    } catch (err: any) {
      console.error(`[QQBot] [${appId}] 请求 access_token 异常:`, err?.message || err)
      return null
    } finally {
      tokenInflightMap.delete(appId)
    }
  })()

  tokenInflightMap.set(appId, promise)
  return promise
}

/** 重置 Token 缓存（测试或主动刷新用） */
export function clearOfficialTokenCache(): void {
  tokenCacheMap.clear()
  tokenInflightMap.clear()
}

/**
 * 官方 Webhook 回调验签算法（Ed25519）
 */
export function qqOfficialSignature(secret: string, eventTs: string, plainToken: string): string {
  if (!secret) return ''
  let seed = secret
  while (seed.length < 32) seed = seed + seed
  seed = seed.slice(0, 32)

  const message = Buffer.from(`${eventTs}${plainToken}`, 'utf8')
  const pkcs8Der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(seed, 'utf8'),
  ])

  const privateKey = crypto.createPrivateKey({
    key: pkcs8Der,
    format: 'der',
    type: 'pkcs8',
  })

  return crypto.sign(null, message, privateKey).toString('hex')
}

/**
 * 规范化解析并清洗目标列表（支持逗号/分号切分、剥离 qqbot: 前缀、过滤非 QQ 通道）
 * 示例：'qqbot:AAA, dingtalk:cid..., BBB' -> ['AAA', 'BBB']
 */
export function parseOfficialTargets(raw: string): string[] {
  if (!raw) return []
  const items = raw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
  const results: string[] = []

  for (const item of items) {
    if (item.includes(':')) {
      const [proto, target] = item.split(':', 2)
      // 只放行 qqbot: 或纯 openid，跳过 dingtalk: 等其他协议
      if (proto.toLowerCase() === 'qqbot' && target.trim()) {
        results.push(target.trim())
      }
    } else {
      results.push(item)
    }
  }

  // 去重
  return [...new Set(results)]
}

/** 剥离文本中的 URL（用于 304003 URL 未报备时的降级重发） */
function stripUrls(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s，,）)\u4e00-\u9fa5]+/g, '')
    .trim()
}

export interface SendOfficialMessageOptions {
  kind: 'group' | 'private'
  /** 群 group_openid 或 用户 openid（支持单个或逗号分隔的多目标） */
  target: string
  text: string
  markdown?: string
  /** 被动回复关联的消息 ID（可选） */
  msgId?: string
  /** 被动回复关联的事件 ID（可选） */
  eventId?: string
  /** 指定使用的机器人 AppId（可选，默认自动选择） */
  appId?: string
}

/**
 * 单个目标底层投递
 */
async function sendSingleTarget(
  target: string,
  opts: SendOfficialMessageOptions,
  account: BotAccount
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const token = await getOfficialAccessToken(account.appId)
  if (!token) {
    return { ok: false, error: `[${account.appId}] 未获取到有效 access_token` }
  }

  const endpoint = opts.kind === 'group'
    ? `${BASE_URL}/v2/groups/${encodeURIComponent(target)}/messages`
    : `${BASE_URL}/v2/users/${encodeURIComponent(target)}/messages`

  const attemptSend = async (content: string, msgType: number): Promise<Response> => {
    const payload: Record<string, unknown> = {
      content,
      msg_type: msgType,
    }
    if (opts.msgId) payload.msg_id = opts.msgId
    if (opts.eventId) payload.event_id = opts.eventId

    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `QQBot ${token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }

  try {
    let res = await attemptSend(opts.text, 0)
    let body = await res.json().catch(() => null) as any

    if (res.ok) {
      return { ok: true, messageId: body?.id }
    }

    const code = Number(body?.code ?? 0)
    const errMsg = String(body?.message ?? res.statusText)

    // 40034105：群主未开通主动发言权限
    if (code === 40034105) {
      const tip = `[QQBot] 官方主动群消息无权限(40034105)：目标群 ${target} 未开启权限。请群主在 QQ 客户端群设置开启【机器人主动在群聊内发言】`
      console.warn(tip)
      return { ok: false, error: tip }
    }

    // 304003：网址未报备 -> 剥离 URL 降级重试
    if (code === 304003) {
      console.warn(`[QQBot] 触发 304003 网址未报备，剥离 URL 后重试: target=${target}`)
      const stripped = stripUrls(opts.text)
      if (stripped && stripped !== opts.text) {
        res = await attemptSend(stripped, 0)
        body = await res.json().catch(() => null) as any
        if (res.ok) {
          return { ok: true, messageId: body?.id }
        }
      }
    }

    const failureReason = `HTTP ${res.status} [${code}]: ${errMsg}`
    console.warn(`[QQBot] 官方消息投递失败: target=${target}, ${failureReason}`)
    return { ok: false, error: failureReason }
  } catch (err: any) {
    const ex = err?.message || err
    console.error(`[QQBot] 官方消息请求异常: target=${target}, ${ex}`)
    return { ok: false, error: String(ex) }
  }
}

/**
 * 向 QQ 官方机器人 OpenAPI 发送群消息或私聊消息（支持多目标广播投递与多机器人路由）
 */
export async function sendOfficialMessage(
  opts: SendOfficialMessageOptions
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const accounts = getOfficialBotAccounts()
  if (accounts.length === 0) {
    return { ok: false, error: '未配置任何官方机器人账号' }
  }

  const targets = parseOfficialTargets(opts.target)
  if (targets.length === 0) {
    return { ok: false, error: '未解析到有效的 QQ 目标 openid' }
  }

  // 多目标广播遍历发送
  let successCount = 0
  let firstMsgId: string | undefined
  const errors: string[] = []

  for (const t of targets) {
    // 自动选择匹配该目标群的机器人，若无特定绑定则用主机器人
    let selectedAccount = accounts[0]
    if (opts.appId) {
      const found = accounts.find(a => a.appId === opts.appId)
      if (found) selectedAccount = found
    } else {
      const foundByGroup = accounts.find(a => a.groups && a.groups.includes(t))
      if (foundByGroup) selectedAccount = foundByGroup
    }

    const result = await sendSingleTarget(t, opts, selectedAccount)
    if (result.ok) {
      successCount++
      if (!firstMsgId) firstMsgId = result.messageId
    } else {
      errors.push(`${t}: ${result.error}`)
    }
  }

  if (successCount > 0) {
    return { ok: true, messageId: firstMsgId }
  }

  return { ok: false, error: errors.join('; ') }
}
