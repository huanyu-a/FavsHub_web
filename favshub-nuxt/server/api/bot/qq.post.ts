/**
 * POST /api/bot/qq — QQ 机器人官方 OpenAPI「Webhook 回调」端点
 *
 * 规范参考：《QQ 机器人群通知完整技术栈 · 教学文档》§5
 * 1. 验证握手（op=13）：使用对应 AppSecret 对 event_ts + plain_token 进行 Ed25519 签名回传（支持多机器人匹配）
 * 2. 事件分发（op=0）：
 *    - GROUP_AT_MESSAGE_CREATE：群内 @机器人事件
 *      - 自动抓取并记录 group_openid（免人工查找，自动填补配置空白）
 *      - 处理机器人指令，并通过被动回复（带 msg_id）进行响应（不受群主动发言权限限制）
 *    - C2C_MESSAGE_CREATE：私聊事件
 *      - 处理个人指令（我的投稿、帮助、绑定等）并被动回复
 */
import { getHeader, readBody, setResponseStatus } from 'h3'
import { LRUCache } from 'lru-cache'
import { getRawDb } from '../../database'
import { getConfig } from '../../utils/config'
import { getOfficialBotAccounts, qqOfficialSignature, sendOfficialMessage } from '../../utils/qq-official'
import { handleBotCommand } from '../../utils/qq-bot-commands'

/** 事件去重缓存：10 分钟内同一事件仅处理一次 */
const seenEvents = new LRUCache<string, boolean>({ max: 1000, ttl: 10 * 60 * 1000 })

/** 自动将捕获的 group_openid 记录到系统配置（仅当当前未配置时自动填入） */
function autoSaveGroupOpenid(groupOpenid: string): void {
  try {
    const current = String(getConfig('qq_bot_group_id') || '').trim()
    if (!current && groupOpenid) {
      const db = getRawDb()
      db.prepare(
        'INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)'
      ).run('qq_bot_group_id', groupOpenid, Date.now())
      console.log(`[QQBot] 自动捕获并持久化群 group_openid: ${groupOpenid}`)
    }
  } catch (err: any) {
    console.warn('[QQBot] 自动保存 group_openid 失败:', err?.message || err)
  }
}

export default defineEventHandler(async (event) => {
  const ua = getHeader(event, 'user-agent') || ''
  const botAppIdHeader = (getHeader(event, 'x-bot-appid') || '').trim()

  // 基础门控：QQ 开放平台发送的回调固定 User-Agent 为 QQBot-Callback
  if (!ua.includes('QQBot-Callback')) {
    setResponseStatus(event, 403)
    return { error: 'Forbidden: invalid user-agent' }
  }

  const accounts = getOfficialBotAccounts()
  if (accounts.length === 0) {
    console.warn('[QQBot] 收到 QQ 回调，但系统尚未配置官方机器人凭证')
    setResponseStatus(event, 403)
    return { error: 'qq_bot_app_secret not configured' }
  }

  // 多机器人匹配：根据请求头 X-Bot-Appid 寻找对应的机器人账号，若无则使用首个账号
  let matchedAccount = accounts[0]
  if (botAppIdHeader) {
    const found = accounts.find(a => a.appId === botAppIdHeader)
    if (found) {
      matchedAccount = found
    } else {
      console.warn(`[QQBot] X-Bot-Appid (${botAppIdHeader}) 未在系统配置的机器人名单中，回落至默认账号`)
    }
  }

  const body = await readBody(event).catch(() => null) as any
  if (!body || typeof body !== 'object') {
    setResponseStatus(event, 400)
    return { error: 'Invalid body' }
  }

  // ── 1. op=13：回调地址验证握手 ─────────────────────────
  if (body.op === 13) {
    const plainToken = String(body.d?.plain_token ?? '')
    const eventTs = String(body.d?.event_ts ?? '')
    if (!plainToken || !eventTs) {
      setResponseStatus(event, 400)
      return { error: 'Missing plain_token or event_ts in handshake' }
    }

    const signature = qqOfficialSignature(matchedAccount.appSecret, eventTs, plainToken)
    return {
      plain_token: plainToken,
      signature,
    }
  }

  // ── 2. op=0：业务事件推送 ──────────────────────────────
  if (body.op === 0) {
    // 幂等去重
    const eventId = String(body.id || body.d?.id || '')
    if (eventId) {
      if (seenEvents.get(eventId)) {
        setResponseStatus(event, 204)
        return null
      }
      seenEvents.set(eventId, true)
    }

    const eventType = String(body.t || '')
    const d = body.d || {}

    try {
      // 群内 @ 机器人事件
      if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
        const groupOpenid = String(d.group_openid || '').trim()
        if (groupOpenid) {
          autoSaveGroupOpenid(groupOpenid)
        }

        const rawContent = String(d.content || '')
        // 剥离官方 @ 标签 <@!bot_id> 及前后空白
        const text = rawContent.replace(/<@!\d+>/g, '').trim()
        const senderOpenid = String(d.author?.member_openid || '').trim()
        const msgId = String(d.id || '')

        if (text && groupOpenid) {
          const reply = handleBotCommand({
            channel: 'group',
            groupId: groupOpenid,
            senderQQ: senderOpenid,
            text,
          })

          if (reply) {
            // 被动回复（带 msg_id，5 分钟内有效，无需群主动发言权限）
            void sendOfficialMessage({
              kind: 'group',
              target: groupOpenid,
              text: reply,
              msgId,
              eventId: eventId || undefined,
              appId: matchedAccount.appId,
            })
          }
        }
      }

      // 私聊事件
      if (eventType === 'C2C_MESSAGE_CREATE') {
        const senderOpenid = String(d.author?.user_openid || '').trim()
        const rawContent = String(d.content || '')
        const text = rawContent.replace(/<@!\d+>/g, '').trim()
        const msgId = String(d.id || '')

        if (text && senderOpenid) {
          const reply = handleBotCommand({
            channel: 'private',
            senderQQ: senderOpenid,
            text,
          })

          if (reply) {
            void sendOfficialMessage({
              kind: 'private',
              target: senderOpenid,
              text: reply,
              msgId,
              eventId: eventId || undefined,
              appId: matchedAccount.appId,
            })
          }
        }
      }
    } catch (err: any) {
      console.warn('[QQBot] 官方回调事件处理异常（忽略）:', err?.message || err)
    }

    setResponseStatus(event, 204)
    return null
  }

  // 其他未知 op，直接返回 204
  setResponseStatus(event, 204)
  return null
})
