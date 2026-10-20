/**
 * QQ 机器人出站通知服务（双传输）
 *
 * 架构（docs/plans/2026-09-29-dashboard-qqbot.md §B3）：
 *   - 调用方（各端点写库成功后）只做「组装文案 + 入队」，纯同步、零阻塞；
 *   - 模块级队列由 flush 定时器每 1s 投递一条（天然节流防刷屏）；
 *   - 单条失败退避重试最多 3 次（1s / 5s / 25s），仍失败丢弃并 console.warn；
 *   - 总开关不满足直接丢弃：qq_bot_enabled=true，且所选传输的投递通道可用：
 *       transport='onebot'（默认）→ runtimeConfig.qqBotHttpUrl 非空，直连 OneBot 11 HTTP API；
 *       transport='outbox'        → qq_outbox_path 或 NUXT_QQ_OUTBOX_DIR 可解析出 spool 目录，
 *         每条消息写成目录下一个 JSON 文件（tmp+rename 原子发布），由宿主机
 *         scripts/qq-outbox-deliver.py（cron）逐文件消费并转投 `hermes send`
 *         （官方 QQ 群 / 单聊 / 钉钉群，目标串形如 'qqbot:37BC…'、'dingtalk:cid…'，
 *          群目标支持逗号分隔多通道）。
 *   - 待审类提醒：onebot 下 = 群消息尾附 CQ @码；outbox 下 = 群广播 + 私聊主人
 *     （qq_admin_qq 语义在 outbox 下为 Hermes 私聊目标，因官方群主动消息受平台权限限制）。
 *
 * fire-and-forget 铁律：任何失败绝不向上抛出，绝不阻断主请求。
 * onebot 出站用原生 fetch（message 为字符串格式，可含 CQ 码）；outbox 出站为同步 spool 写入。
 */
import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
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

/** 出站总开关：system_config 热配置 */
function botEnabled(): boolean {
  return getConfig('qq_bot_enabled') === 'true'
}

/** 当前出站传输：'outbox'（Hermes 文件队列）或 'onebot'（直连 HTTP API） */
function isOutbox(): boolean {
  return String(getConfig('qq_bot_transport') || 'onebot').trim() === 'outbox'
}

function botHttpUrl(): string {
  try {
    return String(useRuntimeConfig().qqBotHttpUrl || '').trim()
  } catch {
    return ''
  }
}

/**
 * outbox 队列目录（spool）：热配置 qq_outbox_path 优先，回落 runtimeConfig.qqOutboxDir/qq-outbox。
 * 容器内路径，必须位于挂载卷（线上 /opt/favshub/data/qq-outbox ↔ 宿主机 <data>/qq-outbox）。
 */
function outboxDir(): string {
  const p = String(getConfig('qq_outbox_path') || '').trim()
  if (p) return p
  try {
    const dir = String(useRuntimeConfig().qqOutboxDir || '').trim()
    if (dir) return join(dir, 'qq-outbox')
  } catch { /* runtimeConfig 不可用 */ }
  return ''
}

/** 所选传输的投递通道是否可用 */
function transportAvailable(): boolean {
  return isOutbox() ? !!outboxDir() : !!botHttpUrl()
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

/**
 * 写入 outbox spool 目录（一条消息一个 JSON 文件），宿主机 scripts/qq-outbox-deliver.py 消费。
 * 先写 <id>.tmp 再 renameSync 原子发布，消费端只会读到完整文件；生产者从不改名已发布文件。
 *
 * outbox 目标归一化：
 *   - 群目标（qq_bot_group_id）支持逗号分隔多通道（如 'qqbot:37BC…,dingtalk:cid…'），每个目标各写一个文件，独立重试；
 *   - 无 'platform:' 前缀的目标串自动补 'qqbot:'（兼容裸 openid/群 id 配置）；
 *   - 文本做 CQ 实体反转义（构造时按 OneBot 转义过 &#38;/&#91;/&#93;），
 *     outbox 消费端是纯文本通道，不应显示 HTML 实体；@ 由待审提醒的 DM 分支实现，此处不会有裸 CQ 码。
 */
let outboxSeq = 0
function sendToOutbox(item: QueueItem): void {
  const dir = outboxDir()
  if (!dir) throw new Error('qq_outbox_path/NUXT_QQ_OUTBOX_DIR 未配置')
  mkdirSync(dir, { recursive: true })
  const now = Date.now()
  const iso = new Date(now).toISOString()
  const targets = String(item.target || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(t => (/^[a-z0-9_-]+:/i.test(t) ? t : `qqbot:${t}`))
  const text = unescapeCqText(item.text)
  for (const target of targets) {
    outboxSeq += 1
    const base = `${now}-${process.pid}-${outboxSeq}`
    const tmp = join(dir, `${base}.tmp`)
    const final = join(dir, `${base}.json`)
    const payload = { v: 1, at: iso, kind: item.kind, target, text }
    writeFileSync(tmp, JSON.stringify(payload) + '\n', 'utf8')
    renameSync(tmp, final) // 原子发布
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
    if (isOutbox()) {
      sendToOutbox(item)
    } else if (item.kind === 'group') {
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

/** 入队（开关判定 + 传输通道判定 + 异常兜底，绝不抛出） */
function enqueue(item: Omit<QueueItem, 'retries' | 'retryAt'>) {
  try {
    if (!botEnabled()) return
    if (!transportAvailable()) return
    queue.push({ ...item, retries: 0, retryAt: 0 })
    ensureFlushTimer()
  } catch (err: any) {
    console.warn('[QQBot] 消息入队失败（忽略）:', err?.message || err)
  }
}

// ─── 出站通知配额（防「把站点当刷屏放大器」） ─────────────────

/**
 * 为什么需要它
 *
 * 通知类消息由**用户行为**触发：`PUT /api/token-deals/:id` 在「被驳回 → 重新提交」时
 * 会给群里发一条待审提醒，提示词审核请求同理。这类端点原本没有出站限频，登录用户
 * 循环提交就能持续驱动服务端出站 HTTP（OneBot）——这是本仓库唯一能被做成放大器的路径
 * （对外公开的订阅 / 事件链路是**零出站**的）。
 *
 * 两层保护：
 *   1. **同一条提醒 10 分钟内只发一次**（按 kind + 标题去重）——正常用户改完再提交
 *      不该重复 @ 管理员；这也顺带挡住了「同一个通告反复提交」的刷屏。
 *   2. **全站通知 N 条/小时**（`qq_notify_max_per_hour`，默认 40）——真到这个量就是滥用
 *      而不是业务，超出的直接丢弃并 warn（不会积压，也不会事后补发）。
 *
 * 机器人**指令回复**（queueBotReply）不占这个配额：那是正常聊天，被限会显得机器人坏掉。
 */
const NOTIFY_DEDUP_MS = 10 * 60 * 1000
const notifySentAt: number[] = []
const notifyDedupAt = new Map<string, number>()
let notifyDropped = 0

function notifyMaxPerHour(): number {
  try {
    const n = parseInt(String(getConfig('qq_notify_max_per_hour') || ''), 10)
    return Number.isFinite(n) && n > 0 ? n : 40
  } catch {
    return 40
  }
}

/** 配额判定：true = 允许发；false = 被去重或超配额丢弃 */
function allowNotify(kind: string, subject: string): boolean {
  // 机器人关着就别记配额：否则「临时关闭 → 一小时后打开」会发现配额被空跑了
  if (!botEnabled()) return false
  const now = Date.now()
  const key = `${kind}:${String(subject || '').trim()}`

  const last = notifyDedupAt.get(key)
  if (last && now - last < NOTIFY_DEDUP_MS) return false

  // 滑动窗口：只保留最近 1 小时的发送时间
  while (notifySentAt.length && now - notifySentAt[0] > 60 * 60 * 1000) notifySentAt.shift()
  const max = notifyMaxPerHour()
  if (notifySentAt.length >= max) {
    notifyDropped += 1
    if (notifyDropped === 1 || notifyDropped % 50 === 0) {
      console.warn(`[QQBot] 出站通知达到上限 ${max} 条/小时，已丢弃 ${notifyDropped} 条（防止被当作刷屏放大器）`)
    }
    return false
  }

  notifySentAt.push(now)
  notifyDedupAt.set(key, now)
  // 顺手清理过期去重键，避免 Map 无限增长
  if (notifyDedupAt.size > 500) {
    for (const [k, t] of notifyDedupAt) if (now - t > NOTIFY_DEDUP_MS) notifyDedupAt.delete(k)
  }
  return true
}

/** 供测试 / 排障查看当前配额状态 */
export function notifyQuotaState(): { sentLastHour: number; maxPerHour: number; dedupKeys: number; dropped: number } {
  const now = Date.now()
  const sent = notifySentAt.filter(t => now - t <= 60 * 60 * 1000).length
  return { sentLastHour: sent, maxPerHour: notifyMaxPerHour(), dedupKeys: notifyDedupAt.size, dropped: notifyDropped }
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

/**
 * 待审类提醒（需要主人行动的消息）：
 *   - onebot：群消息尾附 CQ @码（已绑定管理员优先，回落 qq_admin_qq）
 *   - outbox：群广播 + 私聊主人（qq_admin_qq 语义 = Hermes 私聊目标）。
 *     官方 QQ 群不支持机器人主动 @ 成员（「主动消息」权限另受限），DM 主人是已实测可达的提醒通道。
 */
function queuePendingNotice(text: string): void {
  if (isOutbox()) {
    queueGroupMessage(text)
    const adminTarget = String(getConfig('qq_admin_qq') || '').trim()
    if (adminTarget) queuePrivateMessage(adminTarget, text)
  } else {
    queueGroupMessage(withAdminMention(text))
  }
}

/** onebot 模式：群消息尾部追加 CQ 码 @管理员（未配置管理员 QQ 号则不加） */
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

/**
 * escapeCqText 的逆过程：outbox（Hermes）通道按纯文本投递，不应携带 HTML 实体。
 * 仅用于 sendToOutbox；onebot 路径不经过此函数（CQ 码须保持转义态）。
 */
function unescapeCqText(text: string): string {
  return String(text ?? '')
    .replaceAll('&#91;', '[')
    .replaceAll('&#93;', ']')
    .replaceAll('&#38;', '&')
}

/** 待审通告条数（实时 COUNT） */
function countPendingDeals(): number {
  try {
    const db = getRawDb()
    const row = db.prepare(
      "SELECT COUNT(*) AS c FROM token_deals WHERE status = 'pending' AND deleted_at IS NULL"
    ).get() as { c: number } | undefined
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

/** 截断（群消息里长字段只留前 n 字） */
function clipText(text: unknown, n: number): string {
  const t = String(text ?? '').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/**
 * 通告摘要行：`服务商｜额度 xxx` —— 只有标题的群通知几乎无法判断要不要点，
 * 至少把「谁的、给多少」摆在标题下一行。
 */
function dealFacts(deal: any): string {
  const bits: string[] = []
  const provider = clipText(deal?.provider, 20)
  if (provider) bits.push(escapeCqText(provider))
  const quota = clipText(deal?.quota, 26)
  if (quota) bits.push(`额度 ${escapeCqText(quota)}`)
  // 行里的 models 可能是已解析数组，也可能是库里的 JSON 字符串
  let models: string[] = []
  if (Array.isArray(deal?.models)) models = deal.models.map((m: any) => String(m))
  else if (typeof deal?.models === 'string' && deal.models.trim().startsWith('[')) {
    try { models = (JSON.parse(deal.models) as any[]).map(String) } catch { models = [] }
  }
  const modelText = clipText(models.join('/'), 30)
  if (modelText) bits.push(`模型 ${escapeCqText(modelText)}`)
  return bits.join('｜')
}

/** 通告详情链接（站点基址来自 runtimeConfig.public.baseUrl，缺省时只给站内路径） */
function dealLink(deal: any): string {
  const id = String(deal?.id ?? '').trim()
  if (!id) return ''
  let base = ''
  try {
    base = String(useRuntimeConfig().public?.baseUrl || '').replace(/\/+$/, '')
  } catch { /* runtimeConfig 不可用（脚本/测试环境）时只给路径 */ }
  return `${base}/tokens?deal=${encodeURIComponent(id)}`
}

/** 拼「标题 + 摘要 + 链接」三行式正文 */
function dealBody(deal: any, opts: { withLink?: boolean } = {}): string {
  const title = escapeCqText(String(deal?.title ?? ''))
  const facts = dealFacts(deal)
  const link = opts.withLink === false ? '' : dealLink(deal)
  return [facts, link].filter(Boolean).join('\n')
}

/** 新通告待审 → 群（@管理员） */
export function notifyTokenDealPending(deal: any, submitter: string): void {
  const title = String(deal?.title ?? '')
  if (!allowNotify('deal-pending', title)) return
  const lines = [
    `📥 新通告待审：《${escapeCqText(title)}》`,
    dealBody(deal, { withLink: false }),
    `提交人：${escapeCqText(submitter)}，当前待审 ${countPendingDeals()} 条`,
  ].filter(Boolean)
  queuePendingNotice(lines.join('\n'))
}

/** 管理员直接发布 → 群（不 @） */
export function notifyTokenDealPublished(deal: any): void {
  const title = String(deal?.title ?? '')
  if (!allowNotify('deal-published', title)) return
  queueGroupMessage([`🆕 新通告发布：《${escapeCqText(title)}》`, dealBody(deal)].filter(Boolean).join('\n'))
}

/** 通告修改回待审 → 群（@管理员） */
export function notifyTokenDealRePending(deal: any): void {
  const title = String(deal?.title ?? '')
  // 这条最容易被反复触发：同一条通告 10 分钟内只提醒一次
  if (!allowNotify('deal-repending', title)) return
  const lines = [
    `✏️ 通告《${escapeCqText(title)}》已修改，重新进入待审`,
    dealBody(deal),
    `当前待审 ${countPendingDeals()} 条`,
  ].filter(Boolean)
  queuePendingNotice(lines.join('\n'))
}

/** 通告删除 → 群 */
export function notifyTokenDealDeleted(deal: any): void {
  const title = String(deal?.title ?? '')
  if (!allowNotify('deal-deleted', title)) return
  // 已删除的通告点进去是 404，不带链接
  queueGroupMessage([`🗑️ 通告《${escapeCqText(title)}》已删除`, dealBody(deal, { withLink: false })].filter(Boolean).join('\n'))
}

/** 通告审核通过 → 群 + 私聊作者（若已绑定 QQ） */
export function notifyTokenDealApproved(deal: any, authorUserId: number): void {
  const title = String(deal?.title ?? '')
  if (!allowNotify('deal-approved', title)) return
  queueGroupMessage([`✅ 通告《${escapeCqText(title)}》已发布`, dealBody(deal)].filter(Boolean).join('\n'))
  const qq = getBoundQQ(authorUserId)
  if (qq) queuePrivateMessage(qq, `✅ 你投稿的通告《${escapeCqText(title)}》已通过审核，感谢贡献！`)
}

/** 通告驳回 → 私聊作者（若已绑定 QQ） */
export function notifyTokenDealRejected(deal: any, authorUserId: number, reason: string): void {
  const title = String(deal?.title ?? '')
  if (!allowNotify('deal-rejected', title)) return
  const qq = getBoundQQ(authorUserId)
  if (qq) queuePrivateMessage(qq, `❌ 你投稿的通告《${escapeCqText(title)}》未通过审核：${escapeCqText(reason) || '未填写原因'}`)
}

// ── 提示词事件 ──────────────────────────────────────────────

/** 提示词修改待审 → 群（@管理员） */
export function notifyPromptReviewPending(title: string): void {
  if (!allowNotify('prompt-review', title)) return
  queuePendingNotice(`📝 提示词《${escapeCqText(title)}》有新的修改审核请求，当前待审 ${countPendingPromptReviews()} 条`)
}

/** 提示词审核通过 → 私聊提交人（若已绑定 QQ） */
export function notifyPromptReviewApproved(title: string, submitterUserId: number): void {
  if (!allowNotify('prompt-approved', title)) return
  const qq = getBoundQQ(submitterUserId)
  if (qq) queuePrivateMessage(qq, `✅ 你提交的提示词《${escapeCqText(title)}》已通过审核，感谢贡献！`)
}

/** 提示词审核驳回 → 私聊提交人（若已绑定 QQ） */
export function notifyPromptReviewRejected(title: string, submitterUserId: number, reason: string): void {
  if (!allowNotify('prompt-rejected', title)) return
  const qq = getBoundQQ(submitterUserId)
  if (qq) queuePrivateMessage(qq, `❌ 你提交的提示词《${escapeCqText(title)}》未通过审核：${escapeCqText(reason) || '未填写原因'}`)
}
