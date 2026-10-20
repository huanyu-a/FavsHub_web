/**
 * GET /api/token-deals/changes — 通告变更增量流（对外订阅的主接口）
 *
 * ## 语义
 *
 *   ?tail=1        只回当前游标（首次基线）。**首次接入必须用它**，否则一装技能就被灌历史
 *   ?since=<seq>   返回 seq 之后的事件；不带 since 且不带 tail 时回最近 limit 条（带 notice）
 *   ?limit=50      1..deal_changes_max_limit
 *   ?kinds=online,offline  只看指定类型（默认全部；pinned 需显式点名）
 *   ?token=<sub>   按订阅的过滤条件个性化
 *
 * 响应：`{ events[], next_since, has_more, server_time }`。客户端把 `next_since` 存下来当下次的 since。
 *
 * ## 为什么游标推进到「取到的最大 seq」而不是「命中的最大 seq」
 *
 * 带 token 过滤时，未命中的事件也必须把游标推过去，否则订阅方会一直在同一段区间里反复
 * 扫描（每轮都重新过滤一遍被排除的事件），最终变成 O(n²) 的空转。
 */
import { getRawDb } from '../../database'
import { getConfig, getConfigInt } from '../../utils/config'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import { DEAL_EVENT_KINDS, currentEventSeq, publicEventViews } from '../../utils/deal-events'
import {
  effectiveKinds, filtersMatchEvent, parseFilters, recordSubscriptionPull, resolveSubscription,
} from '../../utils/deal-subscriptions'

export default defineEventHandler((event) => {
  if (getConfig('deal_changes_public') === 'false') {
    throw createError({ statusCode: 404, data: { error: '接口未开放' } })
  }

  const q = getQuery(event)
  const db = getRawDb()
  const config = useRuntimeConfig(event)
  const baseUrl = String(config.public?.baseUrl || '').replace(/\/+$/, '')

  // 轮询友好：每 IP 每小时 60 次（10 分钟一次只占 6 次）
  checkRateLimit(`deal_changes:${getClientIP(event)}`, 60, 60 * 60 * 1000)

  const maxLimit = Math.min(200, Math.max(1, getConfigInt('deal_changes_max_limit', 100)))
  const limit = Math.min(maxLimit, Math.max(1, Number(q.limit) || 50))

  // 订阅（可选）：只用来做过滤与记账；过期/退订的 token 一律 404（不泄露存在性）
  let sub = null as ReturnType<typeof resolveSubscription>
  if (q.token) {
    sub = resolveSubscription(db, q.token)
    if (!sub) throw createError({ statusCode: 404, data: { error: '订阅不存在或已退订' } })
  }

  const maxSeq = currentEventSeq(db)
  const serverTime = Date.now()

  // 暂停中的订阅：直接回空结果（必须早于 304 —— 否则客户端带 If-None-Match 时
  // 永远拿不到 paused 提示，后台的「最近来拉」也不会更新）
  if (sub && sub.status === 'paused') {
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return {
      events: [],
      next_since: Number(sub.cursor) || 0,
      has_more: false,
      paused: true,
      notice: '该订阅已暂停（PATCH 传 status:"active" 恢复）',
      server_time: serverTime,
    }
  }

  // kinds 归一：白名单 + 去重 + 上限（未收敛的原始串还曾导致 ETag 头含非 Latin1 字符时 500）
  const kindsParam = Array.from(new Set(
    String(q.kinds ?? '').split(',').map(s => s.trim()).filter(Boolean),
  )).filter(k => (DEAL_EVENT_KINDS as readonly string[]).includes(k)).slice(0, 5)

  // 轮询友好：无变化时 304（轮询方带 If-None-Match 即可省掉整包 body）
  // ETag 里带上订阅 id：不同订阅（过滤条件不同）不能共用同一个 304 命中
  const etag = `W/"tdseq-${maxSeq}-${String(q.since ?? '')}-${limit}-${kindsParam.join('|') || 'all'}-${sub ? sub.id : ''}"`
  setResponseHeader(event, 'ETag', etag)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'X-Token-Deal-Seq', String(maxSeq))
  if (getHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }

  // 首次基线
  if (q.tail === '1' || q.tail === 'true') {
    return { events: [], next_since: maxSeq, has_more: false, server_time: serverTime, baseline: true }
  }

  const filters = sub ? parseFilters(sub.filters) : {}
  const kinds = kindsParam.length ? kindsParam : (sub ? effectiveKinds(filters) : null)
  const kindClause = kinds ? ` AND kind IN (${kinds.map(() => '?').join(',')})` : ''

  let since = 0
  let cursorResetNotice = ''
  let mode: 'incremental' | 'latest' = 'incremental'
  if (q.since === undefined || q.since === '') {
    mode = 'latest'
  } else {
    const n = Number(q.since)
    if (!Number.isInteger(n) || n < 0) {
      throw createError({ statusCode: 400, data: { error: 'since 必须是非负整数（事件序号）' } })
    }
    if (n > maxSeq) {
      // 游标超前：事件可能已被保留期清理（`seq` 是 AUTOINCREMENT，清空后 maxSeq 会回落）。
      // 对无人值守的 cron 来说 400 等于永久静默失败；而客户端既然声称「看过 n 之前的一切」，
      // 归位到 maxSeq 不会跳过任何它还没见过的序号。因此这里只警告 + 归位，不报错。
      console.warn(`[deal-changes] since(${n}) 超过当前序号(${maxSeq})，已归位`)
      cursorResetNotice = `游标 ${n} 超前于当前事件序号 ${maxSeq}（旧事件可能已被保留期清理），已归位到 ${maxSeq}`
    }
    since = Math.min(n, maxSeq)
  }

  const where = `WHERE public = 1${mode === 'incremental' ? ' AND seq > ?' : ''}${kindClause}`
  const params: any[] = mode === 'incremental' ? [since] : []
  if (kinds) params.push(...kinds)

  const rows = db.prepare(
    mode === 'incremental'
      ? `SELECT * FROM token_deal_events ${where} ORDER BY seq ASC LIMIT ?`
      : `SELECT * FROM token_deal_events ${where} ORDER BY seq DESC LIMIT ?`
  ).all(...params, limit + 1) as any[]

  const hasMoreRaw = rows.length > limit
  const page = hasMoreRaw ? rows.slice(0, limit) : rows
  const ordered = mode === 'incremental' ? page : page.slice().reverse()

  let views = publicEventViews(db, ordered, { baseUrl })
  if (sub) {
    views = views.filter(v => filtersMatchEvent(filters, { kind: v.kind, deal: v.deal }))
  }

  // 游标推进到「取到的最大 seq」（见文件头注释）
  const nextSince = ordered.length ? Math.max(since, Number(ordered[ordered.length - 1].seq)) : since

  if (sub) recordSubscriptionPull(db, sub.id, nextSince)

  const body: Record<string, any> = {
    events: views,
    next_since: nextSince,
    has_more: hasMoreRaw && views.length > 0,
    server_time: serverTime,
  }
  if (mode === 'latest') {
    body.notice = '未带 since：已返回最近的事件。首次接入请用 ?tail=1 取基线，避免历史刷屏。'
  }
  if (cursorResetNotice) {
    body.notice = cursorResetNotice
    body.cursor_reset = true
  }
  return body
})
