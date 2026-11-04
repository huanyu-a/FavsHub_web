/**
 * PUT /api/token-deals/:id — 编辑通告（**全量替换**语义，未传的可写字段会落成默认值）
 *
 * 权限：通告作者或管理员。
 *
 * 可写字段：provider / title / url / call_url / quota / models / region / quality /
 * source_tag / category / expires_at / note / real_name / real_name_other /
 * summary / limits / requirements / verify_scope / faq，以及 **仅管理员**的 `featured`。
 * `source_url`（运营字段）**不接受**任何身份写入 —— 列清单里根本没有它。
 *
 * 状态流转（站点规则：通告内容允许所有人修改，但需经作者或管理员审核）：
 *   - 作者是本人通告的审核人之一 → 直接编辑**即刻生效**，不再退回待审；
 *   - 例外：通告处于 `rejected` 时，作者修正后回到 `pending` 交管理员过目 ——
 *     否则「驳回」这一动作对作者没有任何约束力；
 *   - 管理员编辑保持原状态。
 *
 * 他人对通告的修改走**提案**通道（`POST /api/token-deals/:id/edits`），不经过本端点。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import {
  clearDealInvalid, diffDealPatch, payloadToPatch, validateDealPayload, DEAL_PATCHABLE,
} from '../../utils/token-deals'
import { appendDealEvent } from '../../utils/deal-events'
import { notifyTokenDealRePending } from '../../utils/qq-notify'

/**
 * 读取「精选对比」写入意图 —— **仅管理员**可写（与 `pinned` 同口径）。
 *
 * 返回值三态（**必须**保留「未传」与「显式 false」的区别）：
 *   `null`      = 未传（或非管理员）→ 保持库中原值；
 *   `true`/`false` = 管理员显式传入 → 落 1 / 0。
 *
 * 早先写成「返回 boolean，未传时回落成原值」会让**管理员无法取消精选**
 * （`featured:false` 与未传都是 falsy，落库都变成 1）。
 * 普通用户传了 `featured` **静默忽略**，不 403：与本站既有惯例一致 ——
 * 游客请求体里出现 `nickname` / `turnstile_token` 时「字段级校验只读白名单」直接忽略；
 * `pinned` 也从不作为载荷字段下发。忽略不产生任何越权效果。
 */
function readFeaturedIntent(body: any, isAdmin: boolean): boolean | null {
  if (!isAdmin) return null
  if (body?.featured === undefined || body?.featured === null) return null
  return body.featured === true || body.featured === 1 || body.featured === '1' || body.featured === 'true'
}

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }
  const { user, isAdmin } = role

  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const db = getRawDb()
  const deal = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(id) as any
  if (!deal || deal.deleted_at) {
    // 已删除的通告不可编辑（恢复走管理员端点）
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }
  if (deal.user_id !== user.id && !isAdmin) {
    throw createError({
      statusCode: 403,
      data: { error: '只能编辑自己的通告；修改他人通告请提交修改建议' },
    })
  }

  const result = validateDealPayload(body)
  if (!result.ok) {
    throw createError({ statusCode: 400, data: { error: result.error } })
  }
  const d = result.data

  const status = isAdmin
    ? deal.status
    : (deal.status === 'rejected' ? 'pending' : deal.status)

  // 2026-11-04：state 必须跟着 status 一起走，否则两列会打架。
  // 关键场景 —— 作者编辑一条「被驳回」的条目：status 回到 pending 等待重审，
  // state 也必须回到 pending；否则它仍是 rejected，作者改完了却永远不进审核队列。
  // 管理员编辑不改审核态（status 原样保留），故 state 也原样保留。
  const state = isAdmin
    ? deal.state
    : (deal.status === 'rejected' ? 'pending' : deal.state)

  // 精选对比：管理员显式传了才改，否则保持库中原值（普通用户恒保持原值）。
  // ⚠️ 走请求体而非独立端点，因为 W3 的编辑器是**全量替换**语义的 PUT 表单。
  const featuredIntent = readFeaturedIntent(body, isAdmin)
  const featuredNext = featuredIntent === null ? (deal.featured ? 1 : 0) : (featuredIntent ? 1 : 0)

  try {
    // ⚠️ 列清单与 `index.post.ts` / `ai-service.ts` **三处共用**：
    // 新增可写字段时三处都要补，少改一处会「校验通过但没写库」。
    // `source_url` **刻意不在列清单**：运营字段，只由导入脚本直连 DB 写入，写接口一律拒收
    // （调用方传了也不会落库 —— 白名单式写入，不是靠端点里 `delete body.source_url`）。
    db.prepare(`
      UPDATE token_deals SET
        provider = ?, title = ?, url = ?, call_url = ?, quota = ?, models = ?,
        region = ?, quality = ?, source_tag = ?, category = ?, expires_at = ?, note = ?,
        real_name = ?, real_name_other = ?,
        summary = ?, limits = ?, requirements = ?, verify_scope = ?, faq = ?,
        featured = ?,
        status = ?, state = ?, reject_reason = '', updated_at = ?
      WHERE id = ?
    `).run(
      d.provider, d.title, d.url, d.callUrl, d.quota, JSON.stringify(d.models),
      d.region, d.quality, d.sourceTag, d.category, d.expiresAt, d.note,
      d.realName, d.realNameOther,
      d.summary, d.limits, d.requirements, d.verifyScope, JSON.stringify(d.faq),
      featuredNext,
      status, state, Date.now(), id,
    )
  } catch (err: any) {
    console.error('编辑 Token 白嫖通告失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '编辑失败' } })
  }

  // 续期：作者把有效期往后延（或改为永久）后，撤销因过期而失效的条目 ——
  // 「expired」是客观到期事实，续期即消除该事实；`votes` / `manual` 两类失效不受编辑影响。
  let revived = false
  if (deal.invalid_at && deal.invalid_reason === 'expired'
      && (!d.expiresAt || d.expiresAt > Date.now())) {
    try {
      clearDealInvalid(db, id)   // 内部会写一条 online(restored) 事件
      revived = true
    } catch (err: any) {
      console.warn('[token-deals] 续期后撤销失效失败（忽略）:', err?.message || err)
    }
  }

  // 「变更 / 续期」事件：撤销失效那条 online 已经把「回来了」说清楚，不重复发
  if (!revived) {
    const diff = diffDealPatch(deal, payloadToPatch(d, DEAL_PATCHABLE))
    if (diff.length) {
      const onlyExpiry = diff.every(item => item.field === 'expires_at')
      appendDealEvent(db, id, onlyExpiry ? 'renewed' : 'updated', { before: deal, changes: diff })
    }
  }

  // QQ 机器人通知：被驳回的通告修改后重新进入待审（fire-and-forget，绝不阻断主请求）
  if (status === 'pending' && deal.status === 'rejected') {
    try {
      notifyTokenDealRePending(d)
    } catch (err: any) {
      console.warn('[QQBot] 通告回待审通知入队失败（忽略）:', err?.message || err)
    }
  }

  return {
    success: true,
    status,
    message: status === 'pending' && deal.status === 'rejected'
      ? '已保存，等待管理员重新审核'
      : '已保存',
  }
})
