/**
 * POST /api/qq/bind-code — 生成 QQ 绑定码（需登录）
 *
 * 返回 { code, expiresAt, bound }：code 为 6 位数字（10 分钟有效，
 * 同用户未过期时复用同一个码）；bound 为当前用户已绑定的 QQ 号（未绑定为 null）。
 *
 * 安全设计：本端点只生成码，绑定动作只发生在机器人私聊指令中，
 * 避免「知道用户名即可抢绑」的口子。
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { createBindCode } from '../../utils/qq-bind-codes'
import { getBoundQQ } from '../../utils/qq-notify'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)

  const { code, expiresAt } = createBindCode(user.id)
  const bound = getBoundQQ(user.id) || null

  return { code, expiresAt, bound }
})
