/**
 * 游客订阅（订阅账本）—— 站点侧只做「记账 + 个性化过滤」，**不负责投递**。
 *
 * ## 为什么站点不投递
 *
 * 订阅方是游客自己的 Hermes（跑在他自己的机器 / 服务器上，QQ 机器人挂在里面）。
 * Hermes 默认没有公网入站，站点连不进去；而投递那一步（`hermes send qqbot:...`）
 * 本来就发生在游客机器内部。于是正确分工是：
 *
 *   站点：记事件 → 提供带游标的增量接口（可带 token 做个性化过滤）
 *   游客 Hermes：定时拉 → hermes send 到自己的 QQ 群/单聊
 *
 * 好处：站点**零出站** —— 没有 SSRF 面，也不会被谁当成刷屏放大器；
 * 游客的接收目标、频率、渠道全在他自己手里，站点碰不到，符合「游客只有接收能力」。
 *
 * ## token 即能力
 *
 * 游客无账号，凭 `sub_token`（32 字节随机）访问自己的订阅。站点不提供「列出全部订阅」
 * 的接口 —— 不可猜的 token 是唯一凭证，避免被枚举。
 */
import { createHash, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { DEAL_EVENT_KINDS, DEFAULT_SUBSCRIBE_KINDS } from './deal-events'
import { getConfig } from './config'

/** 订阅状态 */
export const SUBSCRIPTION_STATUSES = ['active', 'paused', 'revoked'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: '生效中',
  paused: '已暂停',
  revoked: '已退订',
}

/** 过滤条件（全部可选，全部为「包含」语义，大小写不敏感） */
export interface SubscriptionFilters {
  kinds?: string[]
  providers?: string[]
  regions?: string[]
  keywords?: string[]
}

/** 单个条件数组的上限（防「用超长过滤器」把接口当 CPU 消耗器） */
const MAX_FILTER_ITEMS = 20
const MAX_FILTER_LEN = 40

export interface SubscriptionRow {
  id: string
  sub_token: string
  label: string
  filters: string
  status: string
  cursor: number
  pull_count: number
  last_pull_at: number | null
  created_ip_hash: string
  created_at: number
  updated_at: number
}

/**
 * 把 IP 收敛成「限频键」再哈希。
 *
 * - IPv4：原样（一个宽带用户 = 一个 /32，收得太紧会误伤整片小区的真游客）
 * - IPv6：收敛到 /64 —— 一个用户通常独占整段 /64，逐地址限频等于没限
 *   （换一个地址就重置配额）。真实 ISP 也基本按 /64 分给一个用户。
 *
 * 只在**限频**上用这个键；`created_ip_hash` 仍用原始地址（便于后台排查同源创建）。
 */
export function normalizeIpForKey(ip: unknown): string {
  const s = String(ip ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!s) return ''
  if (!s.includes(':')) return s           // IPv4：原样
  const bare = s.split('%')[0]             // 去掉 %zone（fe80::1%eth0）

  // 展开 `::` 压缩写法后再取前 4 组 —— 直接 split(':') 会把 `2001:db8::1` 的
  // 空组丢掉，导致 `2001:db8::1` 与 `2001:db8:1::1` 落进同一个桶（不同 /64 互相挤占配额）
  const parts = bare.split('::')
  if (parts.length > 2) return hashKey(bare)   // 非法（多个 ::）→ 不做聚合，退回整串
  const left = parts[0] ? parts[0].split(':') : []
  const right = parts[1] !== undefined && parts[1] ? parts[1].split(':') : []
  const fill = 8 - left.length - right.length
  if (fill < 0) return hashKey(bare)
  const groups = [...left, ...new Array(fill).fill('0'), ...right]
    .map(g => g.padStart(4, '0'))

  // IPv4 映射地址（::ffff:a.b.c.d）：按内嵌的 IPv4 限频，否则所有映射地址挤一个桶
  if (groups.slice(0, 5).every(g => g === '0000') && groups[5] === 'ffff' && groups[7].includes('.')) {
    return groups[7]
  }
  return `${groups.slice(0, 4).join(':')}::/64`
}

/** 无法解析时退回整串（不聚合），避免误伤 */
function hashKey(s: string): string {
  return s
}

/** 限频用的 IP 键（不是身份标识，仅用于配额） */
export function rateKeyForIp(ip: unknown): string {
  return hashIp(normalizeIpForKey(ip))
}

export function hashIp(ip: unknown): string {
  const s = String(ip ?? '').trim()
  if (!s) return ''
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

/** `sub_` + 20 位随机 hex（id 仅用于后台展示与索引） */
export function newSubscriptionId(): string {
  return 'sub_' + randomBytes(10).toString('hex')
}

/** 32 字节随机 hex —— 游客的唯一凭证，不可猜 */
export function newSubToken(): string {
  return randomBytes(32).toString('hex')
}

/** 脱敏展示：保留首尾便于游客自己核对，中间打码 */
export function maskSubToken(token: string): string {
  const t = String(token || '')
  if (t.length <= 12) return t ? t.slice(0, 2) + '***' : ''
  return `${t.slice(0, 6)}…${t.slice(-4)}`
}

/** 归一化过滤条件：白名单字段 + 去空 + 限长限量；非法类型一律丢弃（不报错，避免游客脚本难写） */
export function normalizeFilters(raw: unknown): SubscriptionFilters {
  const out: SubscriptionFilters = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const src = raw as Record<string, unknown>

  const strArr = (v: unknown): string[] => {
    if (!v) return []
    const list = Array.isArray(v) ? v : [v]
    const seen = new Set<string>()
    const res: string[] = []
    for (const item of list) {
      const s = String(item ?? '').trim().slice(0, MAX_FILTER_LEN)
      if (!s) continue
      const key = s.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      res.push(s)
      if (res.length >= MAX_FILTER_ITEMS) break
    }
    return res
  }

  const kinds = strArr(src.kinds).filter(k => (DEAL_EVENT_KINDS as readonly string[]).includes(k))
  if (kinds.length) out.kinds = kinds
  const providers = strArr(src.providers)
  if (providers.length) out.providers = providers
  const regions = strArr(src.regions)
  if (regions.length) out.regions = regions
  const keywords = strArr(src.keywords)
  if (keywords.length) out.keywords = keywords
  return out
}

/** 解析库中的 filters 文本（脏数据不抛错） */
export function parseFilters(raw: unknown): SubscriptionFilters {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw
    return normalizeFilters(obj)
  } catch {
    return {}
  }
}

/** 该订阅关心的事件类型（未设置时用默认集合 —— 置顶默认不订阅） */
export function effectiveKinds(filters: SubscriptionFilters): string[] {
  return filters.kinds && filters.kinds.length ? filters.kinds : [...DEFAULT_SUBSCRIBE_KINDS]
}

function includesAny(haystack: unknown, needles: string[]): boolean {
  if (!needles.length) return true
  const h = String(haystack ?? '').toLowerCase()
  if (!h) return false
  return needles.some(n => h.includes(n.toLowerCase()))
}

/** 事件是否命中订阅的过滤条件（event 为事件表一行的公开字段视图） */
export function filtersMatchEvent(
  filters: SubscriptionFilters,
  event: { kind: string; deal?: { provider?: string; title?: string; region?: string; models?: string[] } },
): boolean {
  const kinds = effectiveKinds(filters)
  if (!kinds.includes(event.kind)) return false
  const deal = event.deal || {}
  if (filters.providers?.length && !includesAny(deal.provider, filters.providers)) return false
  if (filters.regions?.length && !includesAny(deal.region, filters.regions)) return false
  if (filters.keywords?.length) {
    const hay = `${deal.provider ?? ''} ${deal.title ?? ''} ${(deal.models ?? []).join(' ')}`
    if (!includesAny(hay, filters.keywords)) return false
  }
  return true
}

/** 按 token 查订阅；查不到或已退订返回 null */
export function resolveSubscription(db: Database.Database, token: unknown): SubscriptionRow | null {
  // 总闸门：`deal_sub_enabled=false` 时整条订阅链路（含查询/改/退订）一律 404，
  // 否则「想整体下掉订阅功能」还得记得同时关掉 4 个端点
  if (getConfig('deal_sub_enabled') === 'false') return null

  const t = String(token ?? '').trim()
  if (t.length < 16 || t.length > 200) return null
  try {
    const row = db.prepare('SELECT * FROM deal_subscriptions WHERE sub_token = ?').get(t) as SubscriptionRow | undefined
    if (!row || row.status === 'revoked') return null
    return row
  } catch {
    return null
  }
}

/** 记录一次成功拉取（只用于后台观测，不参与判重） */
export function recordSubscriptionPull(db: Database.Database, id: string, cursor: number): void {
  try {
    db.prepare(
      'UPDATE deal_subscriptions SET cursor = ?, pull_count = pull_count + 1, last_pull_at = ?, updated_at = ? WHERE id = ?'
    ).run(cursor, Date.now(), Date.now(), id)
  } catch (err: any) {
    console.warn('[deal-subscriptions] 拉取记账失败（忽略）:', err?.message || err)
  }
}

/** 对外视图：token 一律脱敏 */
export function subscriptionView(row: SubscriptionRow, opts: { baseUrl?: string } = {}) {
  const base = String(opts.baseUrl || '').replace(/\/+$/, '')
  const filters = parseFilters(row.filters)
  return {
    id: row.id,
    token_masked: maskSubToken(row.sub_token),
    label: row.label,
    filters,
    status: row.status,
    status_label: SUBSCRIPTION_STATUS_LABELS[row.status] || row.status,
    cursor: row.cursor,
    pull_count: row.pull_count,
    last_pull_at: row.last_pull_at,
    created_at: row.created_at,
    feed_url: `${base}/api/token-deals/feed.atom?token=${row.sub_token}`,
    changes_url: `${base}/api/token-deals/changes?token=${row.sub_token}&since=<游标>`,
    hint: '把 feed_url 填进 Hermes 的订阅（或轮询 changes_url），游标每次响应里的 next_since 即下次的 since。',
  }
}

/**
 * 淘汰死订阅（在 db-init 里按天跑）：
 *
 * - `revoked` 且 90 天没动过 → 直接删（退订行只用于统计，留着没意义）
 * - `active/paused` 且 180 天没来拉过 → 置 `revoked`（游客机器早就不在了；
 *   若他还在跑，下一次拉取会拿到 404 并提示重建 —— 比永久占着配额好）
 *
 * 与事件保留期（默认 90 天）同量级，保证「订阅不会比它订阅的东西活得更久」。
 */
export function pruneDeadSubscriptions(
  db: Database.Database,
  opts: { revokedDays?: number; idleDays?: number; now?: number } = {},
): { deleted: number; revoked: number } {
  const now = opts.now ?? Date.now()
  const revokedDays = opts.revokedDays ?? 90
  const idleDays = opts.idleDays ?? 180
  let deleted = 0
  let revoked = 0
  try {
    const r1 = db.prepare(
      `DELETE FROM deal_subscriptions
        WHERE status = 'revoked' AND updated_at < ?`
    ).run(now - revokedDays * 86400000)
    deleted = Number(r1.changes || 0)

    const r2 = db.prepare(
      `UPDATE deal_subscriptions
          SET status = 'revoked', filters = '{}', updated_at = ?
        WHERE status IN ('active', 'paused')
          AND COALESCE(last_pull_at, created_at) < ?`
    ).run(now, now - idleDays * 86400000)
    revoked = Number(r2.changes || 0)
  } catch (err: any) {
    console.warn('[deal-subscriptions] 死订阅清理失败（忽略）:', err?.message || err)
  }
  return { deleted, revoked }
}
