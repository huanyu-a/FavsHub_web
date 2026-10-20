/**
 * POST /api/admin/token-deals/:id/restore — 生命周期管理（仅管理员）
 *
 * Body: { action, expires_at?, reason?, dry_run? }
 *
 *   action:
 *     - restore_delete   撤销软删除（清 deleted_at / deleted_by），条目回到原审核状态
 *     - restore_invalid  撤销「判定失效」（votes / manual / expired），恢复对外展示
 *     - mark_invalid     手动标记失效（reason 缺省为 manual），从公开列表下架
 *     - extend           延长有效期（expires_at = 毫秒时间戳，须晚于当前时间）
 *     - set_permanent    有效期改为永久（expires_at 置 NULL）
 *
 * 动作之间可重叠处理：如「已删除 + 已过期」，恢复删除时若发现仍在有效期内，
 * 会顺带撤销 expired 类失效；续期 / 改永久同样会撤销 expired 类失效
 * （到期是客观事实，事实消除即失效理由消失）。
 * `votes` / `manual` 两类失效不受续期影响 —— 社区共识与人工判定不该被改期动作覆盖。
 *
 * 全部动作支持 dry_run：只报告将要发生的变更，不落库。
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'
import {
  clearDealInvalid,
  markDealInvalid,
  restoreDeletedDeal,
  type InvalidReason,
} from '../../../../utils/token-deals'
import { appendDealEvent } from '../../../../utils/deal-events'

const ACTIONS = ['restore_delete', 'restore_invalid', 'mark_invalid', 'extend', 'set_permanent'] as const
type Action = (typeof ACTIONS)[number]

function fmt(ts: number | null): string {
  if (!ts) return '永久'
  return new Date(ts).toISOString()
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({} as any))
  const action = String(body?.action || '') as Action
  const dryRun = body?.dry_run === true

  if (!ACTIONS.includes(action)) {
    throw createError({
      statusCode: 400,
      data: { error: `action 取值必须是 ${ACTIONS.join(' / ')}` },
    })
  }

  const db = getRawDb()
  const deal = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(id) as any
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  const now = Date.now()
  const changes: string[] = []
  let nextExpiresAt: number | null | undefined = undefined  // undefined = 不改
  let clearInvalid = false
  let restoreDelete = false
  let markReason: InvalidReason | null = null

  if (action === 'restore_delete') {
    if (deal.deleted_at) {
      restoreDelete = true
      changes.push('撤销软删除（deleted_at / deleted_by 清空）')
    } else {
      changes.push('无需撤销删除（该条目未被删除）')
    }
    if (deal.invalid_at && deal.invalid_reason === 'expired' && deal.expires_at && deal.expires_at > now) {
      clearInvalid = true
      changes.push('同步撤销过期失效（恢复时仍在有效期内）')
    }
  } else if (action === 'restore_invalid') {
    if (deal.invalid_at) {
      clearInvalid = true
      changes.push(`撤销失效（原原因：${deal.invalid_reason || 'unknown'}）`)
    } else {
      changes.push('无需撤销失效（该条目未失效）')
    }
  } else if (action === 'mark_invalid') {
    if (deal.invalid_at) {
      changes.push('已处于失效状态，未重复标记')
    } else {
      const reason: InvalidReason = (['expired', 'votes', 'manual'] as const).includes(body?.reason)
        ? body.reason
        : 'manual'
      markReason = reason
      changes.push(`标记为失效（原因：${reason}）`)
    }
  } else if (action === 'extend') {
    const ts = Number(body?.expires_at)
    if (!Number.isFinite(ts) || ts <= now) {
      throw createError({
        statusCode: 400,
        data: { error: 'expires_at 必须是毫秒时间戳且晚于当前时间（设为永久请用 set_permanent）' },
      })
    }
    nextExpiresAt = ts
    changes.push(`有效期：${fmt(deal.expires_at)} → ${fmt(ts)}`)
    if (deal.invalid_at && deal.invalid_reason === 'expired') {
      clearInvalid = true
      changes.push('同步撤销过期失效（已续期）')
    }
  } else {
    // set_permanent
    if (!deal.expires_at) {
      changes.push('无需修改（有效期已是永久）')
    } else {
      nextExpiresAt = null
      changes.push(`有效期：${fmt(deal.expires_at)} → 永久`)
    }
    if (deal.invalid_at && deal.invalid_reason === 'expired') {
      clearInvalid = true
      changes.push('同步撤销过期失效（已改永久）')
    }
  }

  if (dryRun) {
    return {
      success: true,
      dry_run: true,
      changes,
      current: {
        deleted_at: deal.deleted_at,
        invalid_at: deal.invalid_at,
        invalid_reason: deal.invalid_reason,
        expires_at: deal.expires_at,
      },
    }
  }

  db.transaction(() => {
    if (restoreDelete) restoreDeletedDeal(db, id)
    if (clearInvalid) clearDealInvalid(db, id)
    if (markReason) markDealInvalid(db, id, markReason)
    if (nextExpiresAt !== undefined) {
      db.prepare('UPDATE token_deals SET expires_at = ?, updated_at = ? WHERE id = ?')
        .run(nextExpiresAt, Date.now(), id)
    }
  })()

  // 续期 / 改永久 → 对外「续期」事件（撤销失效那条 online(restored) 已另行写入）
  if (nextExpiresAt !== undefined) {
    appendDealEvent(db, id, 'renewed', {
      before: deal,
      changes: [{ field: 'expires_at', from: deal.expires_at, to: nextExpiresAt }],
    })
  }

  const after = db.prepare(
    'SELECT deleted_at, invalid_at, invalid_reason, expires_at FROM token_deals WHERE id = ?'
  ).get(id) as any

  return {
    success: true,
    changes,
    current: after,
  }
})
