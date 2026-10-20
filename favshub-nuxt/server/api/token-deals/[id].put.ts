/**
 * PUT /api/token-deals/:id — 编辑通告
 *
 * 权限：通告作者或管理员。
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

  try {
    db.prepare(`
      UPDATE token_deals SET
        provider = ?, title = ?, url = ?, call_url = ?, quota = ?, models = ?,
        region = ?, quality = ?, source_tag = ?, category = ?, expires_at = ?, note = ?,
        status = ?, reject_reason = '', updated_at = ?
      WHERE id = ?
    `).run(
      d.provider, d.title, d.url, d.callUrl, d.quota, JSON.stringify(d.models),
      d.region, d.quality, d.sourceTag, d.category, d.expiresAt, d.note,
      status, Date.now(), id,
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
