/**
 * POST /api/bot/onebot — OneBot 11「HTTP POST 上报」入站端点（NapCat → 本应用）
 *
 * 鉴权：`Authorization: Bearer <token>` 或 `?access_token=`，与
 * runtimeConfig.qqBotAccessToken 比对；配置为空或 qq_bot_enabled=false 时 403。
 *
 * 幂等：message_id 经 lru-cache 去重（NapCat 断线重连可能重发同一事件）。
 *
 * 只处理 post_type === 'message'：message_type 区分群聊/私聊，文本取
 * raw_message || message，剥离头部 @CQ 码后 trim 作为指令交给路由。
 * 机器人回复不走上报响应，统一走出站队列（qq-notify）；本端点恒返回
 * { status: 'ok' }（即使处理中出现异常，也避免 NapCat 无谓重试）。
 */
import { timingSafeEqual } from 'node:crypto'
import { LRUCache } from 'lru-cache'
import { getHeader, getQuery, readBody } from 'h3'
import { getConfig } from '../../utils/config'
import { handleBotCommand } from '../../utils/qq-bot-commands'
import { queueBotReply } from '../../utils/qq-notify'

/** message_id 去重缓存：10 分钟内同一事件只处理一次 */
const seenMessages = new LRUCache<string, boolean>({ max: 1000, ttl: 10 * 60 * 1000 })

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const token = String(config.qqBotAccessToken || '').trim()

  // 总开关与密钥配置：未启用 / 未配置 → 拒绝一切上报
  if (!token || getConfig('qq_bot_enabled') !== 'true') {
    throw createError({ statusCode: 403, data: { error: 'QQ 机器人未启用' } })
  }

  // 鉴权：Bearer 头优先，其次 ?access_token=（NapCat 两种方式都常用）
  const header = getHeader(event, 'authorization') || ''
  const queryToken = String((getQuery(event) as Record<string, unknown>).access_token || '')
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : queryToken.trim()
  // 常量时间比较（先比长度）：避免非常量时间 === 比对 token 的理论时序侧信道
  const providedBuf = Buffer.from(provided)
  const tokenBuf = Buffer.from(token)
  if (providedBuf.length === 0 || providedBuf.length !== tokenBuf.length || !timingSafeEqual(providedBuf, tokenBuf)) {
    throw createError({ statusCode: 403, data: { error: 'access_token 无效' } })
  }

  const body = await readBody(event) as any

  // 幂等去重（仅消息事件带 message_id；心跳等 meta 事件直接落到下方忽略）
  const messageId = body?.message_id
  if (messageId !== undefined && messageId !== null) {
    const key = String(messageId)
    if (seenMessages.get(key)) {
      return { status: 'ok' }
    }
    seenMessages.set(key, true)
  }

  if (body?.post_type === 'message') {
    try {
      const channel = body.message_type === 'group' ? 'group' : body.message_type === 'private' ? 'private' : null
      if (channel && body.user_id !== undefined && body.user_id !== null) {
        // 文本：优先 raw_message（字符串含 CQ 码），其次 message（字符串或消息段数组）
        let text = ''
        if (typeof body.raw_message === 'string' && body.raw_message) {
          text = body.raw_message
        } else if (typeof body.message === 'string') {
          text = body.message
        } else if (Array.isArray(body.message)) {
          text = body.message
            .map((seg: any) => (typeof seg === 'string' ? seg : seg?.type === 'text' ? String(seg?.data?.text ?? '') : ''))
            .join('')
        }
        // 剥离头部 @CQ 码后 trim 作为指令
        text = text.replace(/^(?:\s*\[CQ:[^\]]*\]\s*)+/, '').trim()

        if (text) {
          const reply = handleBotCommand({
            channel,
            groupId: body.group_id !== undefined && body.group_id !== null ? String(body.group_id) : undefined,
            senderQQ: String(body.user_id),
            text,
          })
          if (reply) {
            if (channel === 'group') {
              queueBotReply('group', String(body.group_id), reply)
            } else {
              queueBotReply('private', String(body.user_id), reply)
            }
          }
        }
      }
    } catch (err: any) {
      // fire-and-forget 铁律：指令处理失败不影响上报响应
      console.warn('[QQBot] 入站指令处理失败（忽略）:', err?.message || err)
    }
  }

  return { status: 'ok' }
})
