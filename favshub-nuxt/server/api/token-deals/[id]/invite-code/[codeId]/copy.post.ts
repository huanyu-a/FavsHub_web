/**
 * POST /api/token-deals/:id/invite-code/:codeId/copy — 记一次「邀请码被复制」（2026-10-30）
 *
 * 前端在用户点「复制邀请码」时调用。服务端的 `UPDATE ... WHERE copy_count < copy_limit`
 * 是**原子的条件自增**，因此并发下不会超发；达到阈值后该码自动退出抽选池。
 *
 * ## 防刷
 *
 * 阈值语义是「这个码最多被散出去 N 次」，若不限频，恶意者循环调用即可把
 * 通告的所有码一次性烧光（等于对站点做定向 DoS）。
 * 因此按 IP + 通告限频：同一来源每小时最多记 20 次 —— 正常用户复制一两次，
 * 20 次足够覆盖「反复复制 / 换设备」的真实场景，又烧不光整池。
 *
 * 但限频只挡「同一个 IP 烧得多」，挡不住**枚举**：原先本端点只校验
 * 「这个 codeId 属于该通告」，于是随便 POST 一串 codeId 就能把每个码的配额逐个烧满、
 * 把码从抽选池里挤出去（实测把 copy_limit=2 的码两次烧满）。
 * 因此现在**必须带上抽码时下发的短时凭证 `t`**（`{ t: string }`），
 * 证明调用方确实刚被发过这个码。见 `utils/invite-codes.ts` 的 `verifyDrawToken`。
 *
 * **诚实的边界**：`copy_limit` 本质上仍是「防君子不防小人」——
 * 用户完全可以把码手动抄给别人而不点复制按钮。凭证只是让「通过本站接口刷」这条路
 * 变得有成本，无法让计数等于真实散播次数。前端文案也按这个口径写。
 *
 * ## 幂等性说明
 *
 * 本端点**不是幂等的**（每次调用都算一次复制），这是业务语义决定的；
 * 前端只在用户真正执行复制动作时调用，不对页面渲染调用。
 */
import { getRawDb } from '../../../../../database'
import { getAuthRole } from '../../../../../utils/auth'
import { findWritableDeal } from '../../../../../utils/token-deals'
import { recordInviteCodeCopy, verifyDrawToken } from '../../../../../utils/invite-codes'
import { checkRateLimit, getClientIP } from '../../../../../utils/rate-limit'

/** 同一 IP 对同一通告每小时的复制上报上限 */
const COPY_PER_IP_PER_HOUR = 20

export default defineEventHandler(async (event) => {
  const { id, codeId } = getRouterParams(event)
  const dealId = String(id)
  const db = getRawDb()

  checkRateLimit(
    `invite_copy:${getClientIP(event)}:${dealId}`,
    COPY_PER_IP_PER_HOUR,
    3_600_000,
  )

  // 写闸门：已删除 → 404；未过审 → 404；已失效 / 已过期 → 仅管理员（冻结交互，避免失效通告继续计数）
  const role = getAuthRole(event)
  const gate = findWritableDeal(db, dealId, { isAdmin: !!role?.isAdmin })
  if (!gate.ok) {
    throw createError({ statusCode: gate.status, data: { error: gate.error } })
  }

  const cid = Number(codeId)
  if (!Number.isFinite(cid) || cid <= 0) {
    throw createError({ statusCode: 400, data: { error: '无效的邀请码 ID' } })
  }

  // 凭证闸门：挡「枚举 codeId 烧别人配额」。管理员放行，便于后台核验计数。
  const body = await readBody(event).catch(() => ({} as any))
  if (!role?.isAdmin && !verifyDrawToken(dealId, cid, body?.t)) {
    throw createError({
      statusCode: 400,
      data: { error: '邀请码凭证无效或已过期，请刷新页面后重试' },
    })
  }

  const result = recordInviteCodeCopy(db, dealId, cid)
  if (!result.ok) {
    // 已用满 / 已停用：不报错，但明确告知未计数，前端据此刷新一次
    return {
      code: 200,
      data: { recorded: false, reason: result.reason },
      message: '该邀请码已不可用',
    }
  }

  return { code: 200, data: { recorded: true } }
})
