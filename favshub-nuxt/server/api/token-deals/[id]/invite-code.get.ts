/**
 * GET /api/token-deals/:id/invite-code — 公开取「一个」邀请码（2026-10-30）
 *
 * ## 为什么单独一个端点
 *
 * 需求是「用户访问详情页，邀请码按比例出现次数，前端只显示一个」。
 * 如果把码池塞进详情响应，前端的选择逻辑就只是障眼法 —— 打开 F12 全看得见，
 * 「展现比例」与「复制阈值」双双失效。
 * 因此公开侧**只暴露每次随机抽中的那一个**，抽选在服务端完成。
 *
 * ## 可见性
 *
 * 与详情端点同一口径（`canReadDeal`）：已删除仅管理员、已失效/已过期仅作者与管理员。
 * 否则「详情 404 但邀请码照发」等于绕开隔离把失效通告的码继续散出去。
 *
 * ## 用满即消失
 *
 * 抽选只从「启用 且 copy_count < copy_limit」的码里取；
 * 全部用满或全部停用时返回 `code: null`，前端据此不渲染区块。
 *
 * ## 限频（2026-10-30 审查后补）
 *
 * 本端点原先是**完全无限频**的：脚本循环请求就能把整池码全捞走，
 * 「按比例只出现一个」也就失去意义（实测 200 次请求全 200，期间 copy_count 全为 0）。
 * 现在按 IP + 通告限频。
 *
 * **诚实的边界**：限频只是抬高成本，无法根治 —— 「每次随机给一个」这个语义本身
 * 就允许同一个人多刷几次看到不同的码。它挡的是「脚本批量收割」，不挡「手动多刷几遍」。
 *
 * ## 抽中凭证
 *
 * 响应里的 `t` 是给 copy 端点用的短时 HMAC 凭证（证明「确实刚被发过这个码」），
 * 没有它就没法阻止别人枚举 codeId 烧配额。详见 `utils/invite-codes.ts` 的说明。
 */
import { getRawDb } from '../../../database'
import { optionalAuthLoose } from '../../../utils/guest-reviews'
import { isAdminUserById } from '../../../utils/auth'
import { canReadDeal } from '../../../utils/token-deals'
import { pickInviteCode, signDrawToken } from '../../../utils/invite-codes'
import { checkRateLimit, getClientIP } from '../../../utils/rate-limit'

/** 同一 IP 对同一通告每小时的抽码次数上限（正常浏览远远够用） */
const DRAW_PER_IP_PER_HOUR = 60

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const dealId = String(id)
  const db = getRawDb()

  const deal = db.prepare(
    'SELECT id, user_id, status, deleted_at, invalid_at, invalid_reason, expires_at'
    + ' FROM token_deals WHERE id = ?'
  ).get(dealId) as Record<string, any> | undefined

  const viewer = optionalAuthLoose(event)
  if (!deal || !canReadDeal(deal, {
    id: viewer?.id ?? null,
    isAdmin: isAdminUserById(viewer?.id ?? null),
  })) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  // 限频放在可见性判定之后：宁可先给出 404，也不要让 429 变成「这个 id 存在」的探针
  checkRateLimit(
    `invite_draw:${getClientIP(event)}:${dealId}`,
    DRAW_PER_IP_PER_HOUR,
    3_600_000,
  )

  const picked = pickInviteCode(db, dealId)

  return {
    code: 200,
    data: picked
      ? {
          id: picked.id,
          code: picked.code,
          label: picked.label || '',
          t: signDrawToken(dealId, picked.id),
        }
      : { id: null, code: null, label: '', t: '' },
  }
})
