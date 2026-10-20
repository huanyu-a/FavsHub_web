/**
 * 白嫖通告「事件流」—— 对外订阅（Hermes / 技能包 / feed 阅读器）的单一真源。
 *
 * ## 为什么要有事件表，而不是让订阅方比对列表
 *
 * 轮询方只有「上次看到第几号事件」这一个游标，就能精确拿到增量 —— 不需要拉全量做 diff，
 * 也不会因为分页/排序变化而漏掉或重复条目。同时它让「下架」这种**内容已消失**的变化
 * 也能被通知到（列表 diff 永远发现不了「某条不见了」）。
 *
 * ## 公开边界（本模块最重要的约束）
 *
 * 只有**当时对外可见**的通告变化才写事件（`public = 1`）：
 *   - `online`  —— 写入时必须公开可见（审核通过且未过期未删除）
 *   - `offline` —— 写入时必须**此前**公开可见（下架前是公开的，所以有通知价值）
 *   - `updated` / `renewed` / `pinned` —— 写入时必须公开可见
 *
 * `snapshot` 只放公开字段：提交人、审核备注、驳回原因、下架操作人**永不入表**。
 * 于是订阅者能拿到的信息，范围永远 ≤ 匿名访客看公开列表能拿到的范围。
 *
 * ## 与业务写库同事务
 *
 * `appendDealEvent()` 由写路径在同一事务内调用；但内部对整个插入做 try/catch ——
 * 事件是**附加产物**，绝不能因为事件写入失败而把「删除通告」这种主操作一起回滚。
 */
import type Database from 'better-sqlite3'
import { isPubliclyVisible, INVALID_REASON_LABELS, parseDealModels, DEAL_FIELD_LABELS } from './token-deals'
import { getConfig } from './config'

/** 事件类型 */
export const DEAL_EVENT_KINDS = ['online', 'offline', 'updated', 'renewed', 'pinned'] as const
export type DealEventKind = (typeof DEAL_EVENT_KINDS)[number]

/** 中文标签 */
export const DEAL_EVENT_LABELS: Record<string, string> = {
  online: '上新',
  offline: '下架',
  updated: '变更',
  renewed: '续期',
  pinned: '置顶',
}

/** 下架原因的中文说法（对订阅方展示，不含操作人） */
export const OFFLINE_REASON_LABELS: Record<string, string> = {
  expired: '已到期',
  votes: '社区判定失效',
  manual: '管理员下架',
  deleted: '已删除',
  restored: '已撤销失效',
}

/** 默认订阅的事件类型：置顶波动大、信息量低，默认不订阅，需显式开启 */
export const DEFAULT_SUBSCRIBE_KINDS: DealEventKind[] = ['online', 'offline', 'updated', 'renewed']

/**
 * 「此前是否已发布」——离线事件的准入门槛。
 *
 * 只要求「审核通过 + 未软删 + 未失效」，**故意不判 expires_at**：到期归档时该字段已过，
 * 若按时间判可见性，所有过期事件都会被丢掉，订阅方永远收不到「东西没了」的通知。
 */
export function wasPublished(deal: any): boolean {
  if (!deal) return false
  if (deal.status !== 'approved') return false
  if (deal.deleted_at) return false
  if (deal.invalid_at) return false
  return true
}

/** 站点时区固定东八区：容器可能跑在 UTC，日期按 UTC 渲染会差一天 */
const SITE_TZ_OFFSET_MS = 8 * 60 * 60 * 1000

/** 东八区 MM-DD */
export function formatEventDay(ms: number | null | undefined): string {
  if (!ms) return ''
  const d = new Date(ms + SITE_TZ_OFFSET_MS)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${mm}-${dd}`
}

/** 截断到 n 个字符，超出加省略号 */
function clip(text: unknown, n: number): string {
  const s = String(text ?? '').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** 通告公开字段快照（**只允许**出现这里列出的字段） */
export interface DealEventSnapshot {
  id: string
  provider: string
  title: string
  url: string
  quota: string
  /** 领取地址（公开字段；下架 / 脱敏快照会把它剔掉） */
  call_url: string
  models: string[]
  region: string
  quality: string
  /** 通告分类：token=API 额度 / cloud=免费云服务器（旧数据缺省为 token） */
  category: string
  expires_at: number | null
  rating: string
  share_path: string
}

/** 从库中一行生成公开快照 —— 任何非公开字段都不得进入 */
export function buildDealSnapshot(deal: any): DealEventSnapshot {
  const count = Number(deal?.rating_count || 0)
  const avg = count > 0 ? (Number(deal?.rating_sum || 0) / count) : 0
  return {
    id: String(deal?.id ?? ''),
    provider: String(deal?.provider ?? ''),
    title: String(deal?.title ?? ''),
    url: String(deal?.url ?? ''),
    quota: String(deal?.quota ?? ''),
    call_url: String(deal?.call_url ?? ''),
    models: parseDealModels(deal?.models),
    region: String(deal?.region ?? ''),
    quality: String(deal?.quality ?? ''),
    category: String(deal?.category ?? 'token') || 'token',
    expires_at: deal?.expires_at ?? null,
    rating: count > 0 ? avg.toFixed(1) : '',
    share_path: `/tokens?deal=${encodeURIComponent(String(deal?.id ?? ''))}`,
  }
}

/** 事件行（库里存的形态） */
export interface DealEventRow {
  seq: number
  meta?: string
  deal_id: string
  kind: string
  reason: string
  snapshot: string
  public: number
  created_at: number
}

/** 对外返回的事件（`text` 与绝对链接在读取时渲染，使站点换域名后旧事件仍指向当前域名） */
export interface DealEventView {
  seq: number
  kind: string
  kind_label: string
  reason: string
  reason_label: string
  created_at: number
  /** 单行纯文本（≤200 字）：QQ 官方机器人等只吃纯文本的通道用 */
  text: string
  /** 多行 Markdown：钉钉群机器人 / 网站 feed 等支持富文本的通道用 */
  markdown: string
  /** 字段级差异（仅 updated / renewed 有：`额度 100 刀 → 200 刀` 的结构化版本） */
  changes: FieldDiff[]
  deal: DealEventSnapshot
  /** 读侧降级标记：该通告此刻已不可见，快照与差异已收敛为最小信息 */
  deal_redacted?: boolean
}

export interface FieldDiff {
  field: string
  label?: string
  from: any
  to: any
}

/** 单行文案：QQ / 群消息友好，≤ 200 字（富文本用 renderDealEventMarkdown） */
export function renderDealEventText(
  kind: string,
  reason: string,
  snap: DealEventSnapshot,
  opts: { baseUrl?: string; changes?: FieldDiff[] } = {},
): string {
  const label = kind === 'online' && reason === 'restored'
    ? '恢复上架'
    : (kind === 'pinned' && reason === 'unpin' ? '取消置顶' : (DEAL_EVENT_LABELS[kind] || kind))
  const head = `【${label}】${clip(snap.provider, 20)}`
  const title = clip(snap.title, 40)
  const base = String(opts.baseUrl || '').replace(/\/+$/, '')
  const link = base ? `${base}${snap.share_path}` : snap.share_path

  if (kind === 'offline') {
    const why = OFFLINE_REASON_LABELS[reason] || INVALID_REASON_LABELS[reason] || ''
    return clip(`${head}｜${title}${why ? `（${why}）` : ''}`, 200)
  }
  if (kind === 'updated' || kind === 'renewed') {
    const diffs = (opts.changes || []).map(renderDiff).filter(Boolean).join('，')
    return clip(`${head}｜${title}${diffs ? `｜${diffs}` : ''}`, 200)
  }
  if (kind === 'pinned') {
    return clip(`${head}｜${title}｜${link}`, 200)
  }
  // online：上新信息量最大，带上额度 / 到期 / 链接
  const parts = [head, title]
  if (snap.quota) parts.push(`额度 ${clip(snap.quota, 16)}`)
  if (snap.expires_at) parts.push(`到期 ${formatEventDay(snap.expires_at)}`)
  parts.push(link)
  return clip(parts.join('｜'), 200)
}

/** 事件类型的视觉锚点（纯文本与 Markdown 共用一套，避免两边观感不一致） */
function eventEmoji(kind: string, reason: string): string {
  if (kind === 'online') return reason === 'restored' ? '🔄' : '🆕'
  if (kind === 'offline') return '🗑️'
  if (kind === 'updated') return '✏️'
  if (kind === 'renewed') return '⏳'
  if (kind === 'pinned') return reason === 'unpin' ? '📍' : '📌'
  return '🔔'
}

/**
 * 富文本（Markdown）文案 —— 给支持 Markdown 的通道用（钉钉群机器人、Web feed 预览）。
 *
 * QQ 官方机器人**私聊**同样支持 markdown（`msg_type=2`，实测返回 200），与钉钉共用这份富文本；
 * 只有 OneBot 这类没有富文本能力的通道才回退 `text`。
 * 只渲染公开快照里已有的字段；`offline` 与脱敏快照走最小信息，不会漏出额度 / 领取链接。
 */
export function renderDealEventMarkdown(
  kind: string,
  reason: string,
  snap: DealEventSnapshot,
  opts: { baseUrl?: string; changes?: FieldDiff[]; redacted?: boolean } = {},
): string {
  const label = kind === 'online' && reason === 'restored'
    ? '恢复上架'
    : (kind === 'pinned' && reason === 'unpin' ? '取消置顶' : (DEAL_EVENT_LABELS[kind] || kind))
  const base = String(opts.baseUrl || '').replace(/\/+$/, '')
  const link = base ? `${base}${snap.share_path}` : snap.share_path
  const provider = clip(snap.provider, 20) || '未知来源'
  // 首行用 `### ` 标题：钉钉群机器人只在消息含 `### ` / `\n---` / `<font ` 时才走 markdown 卡片，
  // 否则整条按纯文本发（`**` 与 `>` 会原样露出来）。
  const lines = [`### ${eventEmoji(kind, reason)}【${label}】${provider}`, `**${clip(snap.title, 60)}**`]

  if (kind === 'offline') {
    const why = OFFLINE_REASON_LABELS[reason] || INVALID_REASON_LABELS[reason] || ''
    lines.push('', why ? `- 状态：已下架（${why}）` : '- 状态：已下架')
    if (snap.expires_at) lines.push(`- 原到期：${formatEventDay(snap.expires_at)}`)
    return lines.join('\n')
  }

  if (kind === 'updated' || kind === 'renewed') {
    const diffs = (opts.changes || []).map(renderDiff).filter(Boolean)
    if (diffs.length) lines.push('', ...diffs.map(d => `- ${d}`))
    lines.push('', `[查看通告](${link})`)
    return lines.join('\n')
  }

  // online / pinned：把能公开的字段一次说全，省得点进去才知道额度多少
  const facts: string[] = []
  // 云服务器与 API 额度的「看点」完全不同：先说分类，读者才知道该拿什么标准衡量
  if (snap.category === 'cloud') facts.push('类型 免费云服务器')
  if (snap.quota) facts.push(`额度 ${clip(snap.quota, 28)}`)
  if (snap.models && snap.models.length) facts.push(`模型 ${clip(snap.models.join(' / '), 48)}`)
  if (snap.expires_at) facts.push(`到期 ${formatEventDay(snap.expires_at)}`)
  if (snap.rating) facts.push(`评分 ${snap.rating}`)
  if (facts.length) lines.push('', ...facts.map(f => `- ${f}`))
  // 领取地址是「现在还能不能薅」的关键，官网地址放其后做核对
  if (snap.call_url) lines.push('', `领取：${snap.call_url}`)
  if (snap.url) lines.push('', `官网：${snap.url}`)
  if (opts.redacted) {
    // 通告此刻已不可见：不推可点链接（点进去是 404），只留一句说明
    lines.push('', '（该通告已从站点下架或失效，详情页不再可访问）')
    return lines.join('\n')
  }
  lines.push('', `[查看通告](${link})`)
  return lines.join('\n')
}

/** 单条差异的中文渲染：`额度 100 → 200`、`支持模型 +GLM 5 -MiMo` */
function renderDiff(diff: FieldDiff): string {
  const name = diff.label || DEAL_FIELD_LABELS[diff.field] || diff.field
  // 先按**完整值**判断是否真的变了：数组字段（如 models）动辄十几个元素，
  // 若先截断再比较，末尾追加的元素会被裁成一样的开头 → 差异被判成「无变化」，
  // 订阅者就会收到一条「【变更】xxx」却什么都没说的推送。
  if (JSON.stringify(diff.from ?? null) === JSON.stringify(diff.to ?? null)) return ''
  const fmt = (v: any): string => {
    if (v == null || v === '') return '空'
    if (Array.isArray(v)) return v.length ? clip(v.join('/'), 30) : '空'
    if (diff.field === 'expires_at' && typeof v === 'number') return formatEventDay(v)
    return clip(v, 24)
  }
  // 数组字段只说「加了什么 / 去了什么」，比把两个长列表截断后并排摆着有用
  if (Array.isArray(diff.from) && Array.isArray(diff.to)) {
    const from = diff.from.map(String)
    const to = diff.to.map(String)
    const fromSet = new Set(from)
    const toSet = new Set(to)
    const added = to.filter(x => !fromSet.has(x))
    const removed = from.filter(x => !toSet.has(x))
    const parts: string[] = []
    if (added.length) parts.push(`+${clip(added.join('、'), 40)}`)
    if (removed.length) parts.push(`-${clip(removed.join('、'), 40)}`)
    return parts.length ? `${name} ${parts.join(' ')}` : ''
  }
  return `${name} ${fmt(diff.from)} → ${fmt(diff.to)}`
}

/**
 * 追加一条事件。返回 seq；未被写入（不公开 / 无变化 / 失败）时返回 null。
 *
 * @param before 变更前的行：`offline` 靠它判断「此前是否公开」，
 *               缺失时按不公开处理（fail-closed，宁可不通知也不泄露）
 * @param after  变更后的行；缺省时按 dealId 重新读一次
 */
export function appendDealEvent(
  db: Database.Database,
  dealId: string,
  kind: DealEventKind,
  opts: { reason?: string; before?: any; after?: any; changes?: FieldDiff[] } = {},
): number | null {
  try {
    // 总开关：出问题时可以立即停止写入事件流（读侧另有 deal_changes_public 闸门）
    if (getConfig('deal_events_enabled') === 'false') return null

    const after = opts.after ?? db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId)
    if (!after) return null

    const nowPublic = isPubliclyVisible(after) && after.status === 'approved'
    // `offline` 判定「此前是否已发布」——**不**看时间维度：
    // 到期归档这一刻，通告按时间是「已不可见」的，但它确实曾经公开过，
    // 下架通知正是订阅方最需要的那类变化（见 wasPublished 注释）。
    const wasPublic = opts.before ? wasPublished(opts.before) : false

    // 公开边界：见文件头注释
    if (kind === 'offline') {
      if (!wasPublic) return null
    } else if (!nowPublic) {
      return null
    }
    // 变更类事件没有实际差异 → 不产生噪音
    if (kind === 'updated' && (!opts.changes || opts.changes.length === 0)) return null

    // 下架事件只留「能认出是哪条」的最小信息：下架后它的额度 / 模型 / 领取链接
    // 都不该再从公开事件流里读到（尤其软删除 —— 后台认为它已不可见）。
    const snapshot = JSON.stringify(
      kind === 'offline'
        ? offlineSnapshot(buildDealSnapshot(after))
        : buildDealSnapshot(after),
    )
    // 差异原文只存结构、不存渲染结果：文案在读取时现渲染，站点换域名时链接自动跟着变
    const meta = opts.changes && opts.changes.length ? JSON.stringify({ changes: opts.changes }) : ''
    const info = db.prepare(
      'INSERT INTO token_deal_events (deal_id, kind, reason, snapshot, meta, public, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
    ).run(dealId, kind, String(opts.reason ?? ''), snapshot, meta, Date.now())
    return Number(info.lastInsertRowid)
  } catch (err: any) {
    console.warn('[deal-events] 事件写入失败（忽略，不影响主流程）:', err?.message || err)
    return null
  }
}

/** 下架事件的最小快照：认出是哪条，但不留可被继续分发的内容 */
function offlineSnapshot(snap: DealEventSnapshot): Partial<DealEventSnapshot> {
  return {
    id: snap.id,
    provider: snap.provider,
    title: snap.title,
    expires_at: snap.expires_at,
    share_path: snap.share_path,
  }
}

/** 把库中一行渲染成对外视图 */
export function toEventView(row: DealEventRow, opts: { baseUrl?: string } = {}): DealEventView {
  let snap: DealEventSnapshot
  try {
    snap = JSON.parse(row.snapshot || '{}')
  } catch {
    snap = buildDealSnapshot({ id: row.deal_id })
  }
  let changes: FieldDiff[] = []
  try {
    const meta = JSON.parse(row.meta || '{}')
    if (Array.isArray(meta?.changes)) changes = meta.changes
  } catch { /* 脏数据当没有差异处理 */ }

  return {
    seq: row.seq,
    kind: row.kind,
    kind_label: DEAL_EVENT_LABELS[row.kind] || row.kind,
    reason: row.reason,
    reason_label: OFFLINE_REASON_LABELS[row.reason] || INVALID_REASON_LABELS[row.reason] || '',
    created_at: row.created_at,
    text: renderDealEventText(row.kind, row.reason, snap, { baseUrl: opts.baseUrl, changes }),
    markdown: renderDealEventMarkdown(row.kind, row.reason, snap, { baseUrl: opts.baseUrl, changes }),
    changes,
    deal: snap,
  }
}

/**
 * 读侧可见性收敛 —— **不要**跳过这一步直接对外吐 `toEventView`。
 *
 * 事件里的 snapshot 是**写入当时**的公开快照。通告之后可能被软删 / 判定失效 / 到期归档，
 * 那一刻它的额度、模型、领取链接就不该再从公开事件流里读到 —— 而它更早的
 * `online / updated / renewed` 事件还留在表里（`offline` 只是新增了一条）。
 *
 * 这里按「当前可见性」把这些历史事件降级成最小快照 + 清空差异，并在视图上打
 * `deal_redacted`（feed 用它把整条剔除）。刻意**不**做破坏性 UPDATE：管理员恢复上架后，
 * 历史事件又能读到（也没有丢数据）。
 */
export function publicEventViews(
  db: Database.Database,
  rows: DealEventRow[],
  opts: { baseUrl?: string } = {},
): DealEventView[] {
  const ids = Array.from(new Set(rows.map(r => r.deal_id).filter(Boolean)))
  const visible = new Map<string, boolean>()
  if (ids.length) {
    try {
      const ph = ids.map(() => '?').join(',')
      const live = db.prepare(`SELECT * FROM token_deals WHERE id IN (${ph})`).all(...ids) as any[]
      for (const row of live) {
        visible.set(row.id, isPubliclyVisible(row) && row.status === 'approved')
      }
    } catch (err: any) {
      // 查不到可见性时按不可见处理（fail-closed：宁可不发内容，也不泄露）
      console.warn('[deal-events] 可见性查询失败，按不可见处理:', err?.message || err)
    }
  }

  return rows.map((row) => {
    const view = toEventView(row, opts)
    if (visible.get(row.deal_id) === true) return view
    const redacted = offlineSnapshot(view.deal)
    view.deal = redacted as DealEventSnapshot
    view.changes = []
    // 文案也按脱敏后的快照重渲染，避免里面残留额度 / 链接
    view.text = renderDealEventText(row.kind, row.reason, redacted as DealEventSnapshot, { baseUrl: opts.baseUrl })
    view.markdown = renderDealEventMarkdown(row.kind, row.reason, redacted as DealEventSnapshot, { baseUrl: opts.baseUrl, redacted: true })
    view.deal_redacted = true
    return view
  })
}

/** 当前最大 seq（订阅方的基线；空表为 0） */
export function currentEventSeq(db: Database.Database): number {
  try {
    const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM token_deal_events').get() as { seq: number }
    return Number(row?.seq || 0)
  } catch {
    return 0
  }
}

/** 事件保留：默认 90 天（订阅游标只前推，旧事件无人再读） */
export function pruneDealEvents(db: Database.Database, retentionDays: number, now = Date.now()): number {
  try {
    const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 90
    const res = db.prepare('DELETE FROM token_deal_events WHERE created_at < ?').run(now - days * 86400000)
    return res.changes
  } catch (err: any) {
    console.warn('[deal-events] 事件清理失败（忽略）:', err?.message || err)
    return 0
  }
}

/** 彻底删除通告时一并清掉它的事件（否则订阅方会拿到指向不存在通告的历史） */
export function deleteDealEvents(db: Database.Database, dealId: string): void {
  try {
    db.prepare('DELETE FROM token_deal_events WHERE deal_id = ?').run(dealId)
  } catch { /* 忽略 */ }
}
