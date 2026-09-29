/**
 * QQ 机器人出站通知服务（OneBot 11 HTTP API / NapCat）
 *
 * 架构（docs/plans/2026-09-29-dashboard-qqbot.md §B3）：
 *   - 调用方（各端点写库成功后）只做「组装文案 + 入队」，纯同步、零阻塞；
 *   - 模块级队列由 flush 定时器每 1s 投递一条（天然节流防刷屏）；
 *   - 单条失败退避重试最多 3 次（1s / 5s / 25s），仍失败丢弃并 console.warn；
 *   - 总开关不满足直接丢弃：qq_bot_enabled=true 且 qqBotHttpUrl 非空
 *     （群消息还要求 qq_bot_group_id 非空；私聊消息不需要群号）。
 *
 * fire-and-forget 铁律：任何失败绝不向上抛出，绝不阻断主请求。
 * 出站用原生 fetch，不引入新依赖；message 为字符串格式（可含 CQ 码）。
 */
import { getRawDb } from '../database'
import { getConfig } from './config'
import { parseAdminUsers } from './auth'

/** 出站队列条目 */
interface QueueItem {
  kind: 'group' | 'private'
  target: string   // group_id 或 QQ 号
  text: string
  retries: number  // 已重试次数（首次投递失败后从 0 递增）
  retryAt: number  // 最早可再次投递的时间戳（退避期间 > now，flush 跳过）
}

const queue: QueueItem[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null

const FLUSH_INTERVAL_MS = 1000
/** 第 n 次重试前的退避时长（最多重试 3 次） */
const RETRY_BACKOFF_MS = [1000, 5000, 25000]
const SEND_TIMEOUT_MS = 5000

/** 惰性启动 flush 定时器：首次入队才启动，未启用机器人时零开销 */
function ensureFlushTimer() {
  if (flushTimer) return
  flushTimer = setInterval(flushQueue, FLUSH_INTERVAL_MS)
  // 定时器不阻止进程退出（尽力而为的后台投递）
  flushTimer.unref?.()
}

/** 出站总开关：system_config 热配置 + runtimeConfig HTTP 地址 */
function botEnabled(): boolean {
  return getConfig('qq_bot_enabled') === 'true'
}

function botHttpUrl(): string {
  try {
    return String(useRuntimeConfig().qqBotHttpUrl || '').trim()
  } catch {
    return ''
  }
}

function botAccessToken(): string {
  try {
    return String(useRuntimeConfig().qqBotAccessToken || '').trim()
  } catch {
    return ''
  }
}

/** 调用 OneBot 11 HTTP API；失败抛错，由 deliver 统一做退避重试 */
async function sendToOnebot(action: string, payload: Record<string, unknown>): Promise<void> {
  const base = botHttpUrl().replace(/\/+$/, '')
  if (!base) throw new Error('qqBotHttpUrl 未配置')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = botAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${base}${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`OneBot HTTP ${res.status}`)

  // OneBot 11 响应：{ status, retcode }，retcode=0 才算成功
  const data = await res.json().catch(() => null) as { retcode?: number } | null
  if (data && typeof data.retcode === 'number' && data.retcode !== 0) {
    throw new Error(`OneBot retcode=${data.retcode}`)
  }
}

/** 每 1s 投递一条：取队头第一条「退避已到期」的消息 */
function flushQueue() {
  const now = Date.now()
  const idx = queue.findIndex(item => item.retryAt <= now)
  if (idx === -1) return
  const [item] = queue.splice(idx, 1)
  void deliver(item)
}

/** 投递单条消息；失败按 1s/5s/25s 退避回队重试，3 次后丢弃 */
async function deliver(item: QueueItem): Promise<void> {
  try {
    if (item.kind === 'group') {
      // OneBot 的 group_id 期望数字，纯数字串转 Number 兼容严格实现
      const groupId = /^\d+$/.test(item.target) ? Number(item.target) : item.target
      await sendToOnebot('/send_group_msg', { group_id: groupId, message: item.text })
    } else {
      const userId = /^\d+$/.test(item.target) ? Number(item.target) : item.target
      await sendToOnebot('/send_private_msg', { user_id: userId, message: item.text })
    }
  } catch (err: any) {
    if (item.retries >= RETRY_BACKOFF_MS.length) {
      console.warn(`[QQBot] 消息重试 ${item.retries} 次后仍失败，已丢弃: ${err?.message || err}`)
      return
    }
    const backoff = RETRY_BACKOFF_MS[item.retries]
    item.retries += 1
    item.retryAt = Date.now() + backoff
    queue.push(item) // 回队尾，退避到期后由 flushQueue 再次投递
  }
}

/** 入队（开关判定 + 异常兜底，绝不抛出） */
function enqueue(item: Omit<QueueItem, 'retries' | 'retryAt'>) {
  try {
    if (!botEnabled()) return
    if (!botHttpUrl()) return
    queue.push({ ...item, retries: 0, retryAt: 0 })
    ensureFlushTimer()
  } catch (err: any) {
    console.warn('[QQBot] 消息入队失败（忽略）:', err?.message || err)
  }
}

/**
 * 群消息入队：qq_bot_group_id 为空时直接丢弃
 */
export function queueGroupMessage(text: string): void {
  const groupId = String(getConfig('qq_bot_group_id') || '').trim()
  if (!groupId) return
  enqueue({ kind: 'group', target: groupId, text })
}

/**
 * 私聊消息入队
 */
export function queuePrivateMessage(qq: string, text: string): void {
  const target = String(qq || '').trim()
  if (!target) return
  enqueue({ kind: 'private', target, text })
}

/**
 * 机器人指令回复：由调用方指定投递目标（群号 / QQ 号），与通知同队列同链路
 * （入站端点恒返回 { status: 'ok' }，回复不走上报响应）。
 * 仍受总开关门控（qq_bot_enabled + qqBotHttpUrl）——入站端点已在门控之后，正常必满足。
 */
export function queueBotReply(kind: 'group' | 'private', target: string, text: string): void {
  const t = String(target || '').trim()
  if (!t || !text) return
  enqueue({ kind, target: t, text })
}

// ─── 文案组装 helper ─────────────────────────────────────────

/**
 * 解析 @ 提醒的管理员 QQ 号：已绑定的管理员中最早绑定者优先用绑定号
 * （管理员判定与 requireAdmin 同口径：users.is_admin 或 NUXT_ADMIN_USERS 环境名单），
 * 没有已绑定的管理员时回落 qq_admin_qq 配置。
 */
function resolveAdminQQ(): string {
  const fallback = String(getConfig('qq_admin_qq') || '').trim()
  try {
    const db = getRawDb()
    const envAdmins = parseAdminUsers(useRuntimeConfig().adminUsers)
    // 环境名单来自部署方配置（可信），仍用占位符拼接 IN 子句
    const placeholders = envAdmins.map(() => '?').join(',')
    const where = envAdmins.length
      ? `u.is_admin = 1 OR u.username IN (${placeholders})`
      : 'u.is_admin = 1'
    const row = db.prepare(
      `SELECT qb.qq_number AS qq FROM qq_bindings qb JOIN users u ON u.id = qb.user_id WHERE ${where} ORDER BY qb.created_at ASC LIMIT 1`
    ).get(...envAdmins) as { qq: string } | undefined
    if (row?.qq) return row.qq
  } catch { /* 表不存在等，忽略 */ }
  return fallback
}

/** 群消息尾部追加 CQ 码 @管理员（未配置管理员 QQ 号则不加） */
function withAdminMention(text: string): string {
  const adminQQ = resolveAdminQQ()
  return adminQQ ? `${text} [CQ:at,qq=${adminQQ}]` : text
}

/**
 * OneBot 11 字符串格式纯文本转义：& [ ] → &#38; &#91; &#93;。
 * 用户可控文本（通告标题/提交人/提示词标题/驳回原因等）拼入 message 前必须转义，
 * 否则接收端会把文本里的 [CQ:...] 当作代码解析（可注入 @全体成员、伪造图片/引用等）。
 * 注意：有意构造的 CQ 码（如 withAdminMention 的 @ 码）必须在转义之后再拼接。
 */
export function escapeCqText(text: unknown): string {
  return String(text ?? '')
    .replaceAll('&', '&#38;')
    .replaceAll('[', '&#91;')
    .replaceAll(']', '&#93;')
}

/** 待审通告条数（实时 COUNT） */
function countPendingDeals(): number {
  try {
    const db = getRawDb()
    const row = db.prepare("SELECT COUNT(*) AS c FROM token_deals WHERE status = 'pending'").get() as { c: number } | undefined
    return row?.c ?? 0
  } catch {
    return 0
  }
}

/** 待审提示词修改条数（实时 COUNT） */
function countPendingPromptReviews(): number {
  try {
    const db = getRawDb()
    const row = db.prepare("SELECT COUNT(*) AS c FROM prompt_review_requests WHERE status = 'pending'").get() as { c: number } | undefined
    return row?.c ?? 0
  } catch {
    return 0
  }
}

/** 查询用户绑定的 QQ 号（未绑定返回空串） */
export function getBoundQQ(userId: number): string {
  try {
    const db = getRawDb()
    const row = db.prepare('SELECT qq_number FROM qq_bindings WHERE user_id = ?').get(userId) as { qq_number: string } | undefined
    return row?.qq_number || ''
  } catch {
    return ''
  }
}

// ── 通告事件 ────────────────────────────────────────────────

/** 新通告待审 → 群（@管理员） */
export function notifyTokenDealPending(title: string, submitter: string): void {
  queueGroupMessage(withAdminMention(`📥 新通告待审：《${escapeCqText(title)}》（提交人：${escapeCqText(submitter)}），当前待审 ${countPendingDeals()} 条`))
}

/** 管理员直接发布 → 群（不 @） */
export function notifyTokenDealPublished(title: string): void {
  queueGroupMessage(`🆕 新通告发布：《${escapeCqText(title)}》`)
}

/** 通告修改回待审 → 群（@管理员） */
export function notifyTokenDealRePending(title: string): void {
  queueGroupMessage(withAdminMention(`✏️ 通告《${escapeCqText(title)}》已修改，重新进入待审，当前待审 ${countPendingDeals()} 条`))
}

/** 通告删除 → 群 */
export function notifyTokenDealDeleted(title: string): void {
  queueGroupMessage(`🗑️ 通告《${escapeCqText(title)}》已删除`)
}

/** 通告审核通过 → 群 + 私聊作者（若已绑定 QQ） */
export function notifyTokenDealApproved(title: string, authorUserId: number): void {
  queueGroupMessage(`✅ 通告《${escapeCqText(title)}》已发布`)
  const qq = getBoundQQ(authorUserId)
  if (qq) queuePrivateMessage(qq, `✅ 你投稿的通告《${escapeCqText(title)}》已通过审核，感谢贡献！`)
}

/** 通告驳回 → 私聊作者（若已绑定 QQ） */
export function notifyTokenDealRejected(title: string, authorUserId: number, reason: string): void {
  const qq = getBoundQQ(authorUserId)
  if (qq) queuePrivateMessage(qq, `❌ 你投稿的通告《${escapeCqText(title)}》未通过审核：${escapeCqText(reason) || '未填写原因'}`)
}

// ── 提示词事件 ──────────────────────────────────────────────

/** 提示词修改待审 → 群（@管理员） */
export function notifyPromptReviewPending(title: string): void {
  queueGroupMessage(withAdminMention(`📝 提示词《${escapeCqText(title)}》有新的修改审核请求，当前待审 ${countPendingPromptReviews()} 条`))
}

/** 提示词审核通过 → 私聊提交人（若已绑定 QQ） */
export function notifyPromptReviewApproved(title: string, submitterUserId: number): void {
  const qq = getBoundQQ(submitterUserId)
  if (qq) queuePrivateMessage(qq, `✅ 你提交的提示词《${escapeCqText(title)}》已通过审核，感谢贡献！`)
}

/** 提示词审核驳回 → 私聊提交人（若已绑定 QQ） */
export function notifyPromptReviewRejected(title: string, submitterUserId: number, reason: string): void {
  const qq = getBoundQQ(submitterUserId)
  if (qq) queuePrivateMessage(qq, `❌ 你提交的提示词《${escapeCqText(title)}》未通过审核：${escapeCqText(reason) || '未填写原因'}`)
}
