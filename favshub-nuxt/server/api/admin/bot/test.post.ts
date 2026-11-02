/**
 * POST /api/admin/bot/test — 管理员测试 QQ 机器人消息发送
 * 仅管理员可用。
 */
import { requireAdmin } from '../../../utils/auth'
import { sendOfficialMessage, isOfficialConfigured } from '../../../utils/qq-official'
import { getConfig } from '../../../utils/config'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody(event) || {}

  const transport = String(getConfig('qq_bot_transport') || 'official').trim()
  const defaultTarget = String(getConfig('qq_bot_group_id') || '').trim()
  const target = String(body.target || defaultTarget).trim()
  const text = String(body.text || '🤖 FavsHub 机器人测试消息：连接正常！').trim()

  if (!target) {
    throw createError({
      statusCode: 400,
      data: { error: '未指定测试目标，且系统未配置通知群目标（OpenID / 群号）' },
    })
  }

  if (transport === 'official') {
    if (!isOfficialConfigured()) {
      throw createError({
        statusCode: 400,
        data: { error: '尚未配置 QQ 官方机器人的 AppID 或 AppSecret' },
      })
    }

    const res = await sendOfficialMessage({
      kind: 'group',
      target,
      text,
    })

    if (!res.ok) {
      return {
        success: false,
        transport: 'official',
        target,
        error: res.error || '发送失败',
      }
    }

    return {
      success: true,
      transport: 'official',
      target,
      message_id: res.messageId,
      message: '测试消息发送成功',
    }
  }

  // 其他传输方式暂不支持即时同步回显测试结果
  return {
    success: false,
    transport,
    error: `当前传输方式为 ${transport}，仅 official（官方 OpenAPI）支持即时在线连通性测试`,
  }
})
