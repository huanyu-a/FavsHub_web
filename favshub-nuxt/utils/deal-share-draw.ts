/**
 * Token 通告分享卡片 — **纯 Canvas 2D 绘制核心（前后端共用）**
 *
 * 版式固定 3:4（900 × 1200 @2x），**不随站点主题切换**。
 *
 * 绘制坐标按逻辑尺寸 450 × 600 计算，由调用方 `ctx.scale(2)` 输出 2 倍图。
 *
 * ⚠️ 本模块**只依赖 Canvas 2D 上下文**，不依赖 DOM、Image、location、document。
 * 唯一入口 `drawShareCard(ctx, deal, opts)` —— 浏览器（HTMLCanvasElement）与
 * 服务端（@napi-rs/canvas SKRSContext2D）各传各的 ctx，绘制结果一致。
 *
 * 因此：**改动本文件会同时影响网页分享面板与 AI 卡片端点**，改前须两端回归。
 * 浏览器侧包装见 `utils/deal-share.ts`，服务端侧见 `server/utils/deal-card.ts`。
 *
 * 三风格并存，BuildShareOptions.style 切换（默认 magazine）：
 *
 * 风格 A「magazine」编辑杂志 × 票根：
 * - 暖纸底 `#FAF7F1` + 深墨刊头通栏（字距品牌标 + 栏目标 + 明黄品质章 + 紫色刊头线）
 * - 标题 21px 浓墨粗体 + 紫色短杠；免费额度 24px 展示级大数字（字号自适应）
 * - 虚线票根分隔线；健康度三栏细竖线分隔（无色块）；Nexus 单行文字 + 脉冲图标
 * - 页脚实线分隔：左品牌域名、右白卡二维码；左下同心圆纹理 + 右上代币水印
 *
 * 风格 B「neon」深色终端：
 * - 墨蓝 `#0B0E1C→#151C36` 渐变底 + 青/紫双层径向辉光 + 点阵网格
 * - 终端窗口栏（三圆点 + `favshub ~/token-deals` 路径标题 + `[品质]` 琥珀标签）
 * - 等宽字体数据读数（FREE QUOTA / EXPIRES 英文微标签 + 霓虹青大数字）
 * - Nexus 行走 `> nexus probe · ok/total ok · avg` 读数格式；备注走 `// 注释` 风
 * - 健康度 ▲▼★ 霓虹三色；页脚 `› FavsHub 域名` 提示符 + 青边白卡二维码
 *
 * 风格 C「clay」暖阳陶土（大众友好向，对齐 tool.bx9y.com.cn 主题）：
 * - 暖米白 `#FAF9F5` 底 + 陶土橙 `#D97757` 主色 + 鼠尾草绿 `#4A7C59` 语义色
 * - 白色圆角软阴影卡片（drawSoftCard，阴影对齐 --tb-shadow）承载服务商/统计/健康度
 * - 品质 pill / 模型首枚 chip 用陶土橙软底 `#FCE8DD`；Nexus 用绿软 pill 通栏
 * - 标题 21px 暖棕粗体 + 陶土橙圆头短杠；页脚陶土橙品牌方块 + 白卡二维码
 *
 * 两版共用：统一块节奏（基础 12 + 均摊，上限 26），剩余空白 0.45 偏上居中；
 * 块少时虚线提示卡补位；分词断行 + CJK 悬挂标点；图片 4s 超时回退。
 */

export const SHARE_CARD_W = 900
export const SHARE_CARD_H = 1200

const LOGIC_W = 450
const LOGIC_H = 600
const SCALE = 2
const PAD = 26

/** 卡片配色（编辑杂志 × 票根版式） */
const C = {
  paper: '#FAF7F1',
  mast: '#1C1917',
  mastText: '#FAF7F1',
  mastDim: '#A8A29E',
  ink: '#1C1917',
  inkSec: '#57534E',
  inkTer: '#A8A29E',
  rule: '#E6E0D5',
  ruleDark: '#CFC8BA',
  accent: '#6D28D9',
  accentSoft: '#F1ECFB',
  yellow: '#FACC15',
  yellowText: '#3F3000',
  ok: '#15803D',
  danger: '#DC2626',
  amber: '#B45309',
  qr: '#1C1917',
} as const

const FONT_STACK = '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
/** 等宽字体栈：CJK 字体必须在链内——等宽字体不含中文字形，浏览器与 napi-rs 都靠链内回退 */
const MONO_STACK = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, "Courier New", "Microsoft YaHei", "PingFang SC", monospace'

/** 深色终端版配色 */
const N = {
  bgFrom: '#0B0E1C',
  bgTo: '#151C36',
  barBg: 'rgba(255,255,255,0.045)',
  line: 'rgba(148,163,216,0.18)',
  lineSoft: 'rgba(148,163,216,0.14)',
  lineStrong: 'rgba(148,163,216,0.28)',
  cellBg: 'rgba(255,255,255,0.03)',
  text: '#E8ECF7',
  textSec: '#9AA4C7',
  textTer: '#5F6B93',
  cyan: '#22D3EE',
  green: '#34D399',
  amber: '#FBBF24',
  red: '#F87171',
  violet: '#A78BFA',
} as const

/** 暖阳陶土版配色（对齐 tool.bx9y.com.cn 主题变量，Claude 风暖色系） */
const K = {
  bg: '#FAF9F5',
  bgAlt: '#F3F1EA',
  surface: '#FFFFFF',
  text: '#2D2A24',
  textSec: '#6B6660',
  textTer: '#9C978F',
  border: '#E8E5DD',
  borderStrong: '#D5D1C7',
  clay: '#D97757',
  claySoft: '#FCE8DD',
  clayStrong: '#A14A2C',
  sage: '#4A7C59',
  sageSoft: '#D8E8DC',
  danger: '#C44A4A',
  warn: '#C08A3E',
  warnSoft: '#F6EAD8',
  shadow: 'rgba(45,42,36,0.07)',
} as const

/** 喜报爆款版配色（红金高转化氛围，微信/群聊传播向） */
const B = {
  bg: '#FFFDF9',
  bgGrad: '#FFF5EC',
  banner: '#E11D48',
  bannerGrad: '#BE123C',
  bannerText: '#FFFFFF',
  gold: '#F59E0B',
  goldLight: '#FEF08A',
  goldBorder: '#FDE68A',
  goldText: '#92400E',
  cardBg: '#FFFBEB',
  cardBorder: '#FCD34D',
  text: '#1C1917',
  textSec: '#57534E',
  textTer: '#8E877F',
  red: '#E11D48',
  redSoft: '#FFE4E6',
  redBorder: '#FDA4AF',
  stamp: '#DC2626',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  greenText: '#15803D',
} as const

/** 游戏卡券/票根版配色（暗夜高级感、Epic/Steam 喜加一卡券向） */
const V = {
  bgFrom: '#0A0C14',
  bgTo: '#121624',
  ticketBg: '#181C28',
  ticketInner: '#131620',
  ticketBorder: '#283042',
  ticketBorderSoft: '#1F2533',
  borderDashed: '#3B4660',
  text: '#F8FAFC',
  textSec: '#94A3B8',
  textTer: '#64748B',
  green: '#10B981',
  greenSoft: 'rgba(16,185,129,0.12)',
  greenBorder: 'rgba(16,185,129,0.3)',
  greenText: '#34D399',
  amber: '#F59E0B',
  red: '#F43F5E',
  barcode: '#94A3B8',
} as const

/** 卡片风格标识 */
export type ShareCardStyle = 'magazine' | 'neon' | 'clay' | 'blast' | 'voucher'

/**
 * 绘制上下文的最小接口 —— 浏览器 `CanvasRenderingContext2D` 与
 * 服务端 `@napi-rs/canvas` 的 `SKRSContext2D` 均结构兼容。
 *
 * 用 `any` 而非联合类型：两个 lib 的 `measureText` 返回值形状不同
 * （浏览器返回 TextMetrics，napi-rs 返回 { width }），联合会让调用点报错。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ShareCtx = any

/**
 * 位图源 —— 浏览器为 `HTMLImageElement`，服务端为 napi-rs `Image`。
 * 两者都只需满足 `drawImage` 的入参要求，故此处不约束具体类型。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ShareImage = any

const REGION_LABELS: Record<string, string> = { cn: '国内直连', global: '海外' }
const SOURCE_LABELS: Record<string, string> = { official: '官方直营', relay: '中转站', community: '社区转发' }

export interface ShareDealNexus {
  enabled: boolean
  eval_ok: number
  eval_total: number
  eval_avg_ms: number
}

export interface ShareDeal {
  id: string
  provider: string
  title: string
  url: string
  call_url?: string
  quota?: string
  models?: string[]
  region?: string
  quality?: string
  source_tag?: string
  expires_at?: number | null
  pinned?: number
  note?: string
  vote_up?: number
  vote_down?: number
  rating_sum?: number
  rating_count?: number
  nexus?: ShareDealNexus | null
}

/** 一个内容块：自然高度 + 在指定 y 处绘制 */
interface Block {
  height: number
  gap: number
  draw: (y: number) => void
}

function font(size: number, weight: 400 | 500 | 600 | 700 = 400): string {
  return `${weight} ${size}px ${FONT_STACK}`
}

/** 等宽字体（终端版数字 / 读数 / 标签） */
function monoFont(size: number, weight: 400 | 600 | 700 = 400): string {
  return `${weight} ${size}px ${MONO_STACK}`
}

/** 径向辉光（深色底氛围光） */
function radialGlow(ctx: ShareCtx, cx: number, cy: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
}

/** 圆角矩形路径（不直接填充，便于 fill / stroke / clip 复用） */
function roundRect(ctx: ShareCtx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** 单行截断：超出宽度时二分查找可容纳长度并补省略号 */
function ellipsize(ctx: ShareCtx, text: string, maxWidth: number): string {
  const str = String(text ?? '')
  if (!str) return ''
  if (ctx.measureText(str).width <= maxWidth) return str
  const chars = Array.from(str)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(chars.slice(0, mid).join('') + '…').width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? chars.slice(0, lo).join('') + '…' : '…'
}

/**
 * 断行分词：连续的 ASCII 字母/数字/符号视为一个不可拆的整体，
 * 避免「1200 万 tokens」被拆成「1 / 200 万 tokens」这类割裂。
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let buf = ''
  for (const ch of text) {
    if (/[A-Za-z0-9._+\-/:@]/.test(ch)) {
      buf += ch
      continue
    }
    if (buf) { tokens.push(buf); buf = '' }
    tokens.push(ch)
  }
  if (buf) tokens.push(buf)
  return tokens
}

/** CJK 行首悬挂标点：断行时不应出现在新行开头，允许挂在行尾（轻微溢出可接受） */
const LEADING_PUNCT = /^[，。、；：？！）》”』]/

/** 多行换行：按分词贪心填充，超出 maxLines 时把余量并入末行并截断 */
function wrapText(ctx: ShareCtx, text: string, maxWidth: number, maxLines: number): string[] {
  const normalized = String(text ?? '').replace(/\s*\n\s*/g, ' ').trim()
  if (!normalized) return []
  const lines: string[] = []
  let cur = ''
  for (const token of tokenize(normalized)) {
    // 单个分词本身就超宽（极长的 URL 等）时按字符强拆
    if (!cur && ctx.measureText(token).width > maxWidth) {
      let piece = ''
      for (const ch of token) {
        if (ctx.measureText(piece + ch).width <= maxWidth) piece += ch
        else { lines.push(piece); piece = ch }
      }
      cur = piece
      continue
    }
    if (!cur || ctx.measureText(cur + token).width <= maxWidth) {
      cur += token
    } else if (LEADING_PUNCT.test(token)) {
      // 悬挂标点：留在行尾，不顶到新行行首
      cur += token
      lines.push(cur)
      cur = ''
    } else {
      lines.push(cur)
      cur = token
    }
  }
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines
  const head = lines.slice(0, maxLines - 1)
  head.push(ellipsize(ctx, lines.slice(maxLines - 1).join(''), maxWidth))
  return head
}

function initialOf(provider?: string): string {
  return (String(provider || '?').trim().charAt(0) || '?').toUpperCase()
}

/** 代币图标（线稿：同心圆 + 四向刻度） */
function drawCoin(ctx: ShareCtx, cx: number, cy: number, r: number, color: string, lw = 1.6): void {
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2)
  ctx.stroke()
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    ctx.beginPath()
    ctx.moveTo(cx + dx * (r + 1.5), cy + dy * (r + 1.5))
    ctx.lineTo(cx + dx * (r + 4), cy + dy * (r + 4))
    ctx.stroke()
  }
}

/** 日历图标（线稿） */
function drawCalendar(ctx: ShareCtx, x: number, y: number, s: number, color: string): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  roundRect(ctx, x, y + 1, s, s - 1, 2.5)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, y + s * 0.4)
  ctx.lineTo(x + s, y + s * 0.4)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x + s * 0.3, y - 1)
  ctx.lineTo(x + s * 0.3, y + 3)
  ctx.moveTo(x + s * 0.7, y - 1)
  ctx.lineTo(x + s * 0.7, y + 3)
  ctx.stroke()
}

/** 心跳脉冲图标（Nexus 实测） */
function drawPulse(ctx: ShareCtx, x: number, y: number, w: number, color: string): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.8
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const h = w * 0.5
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + w * 0.28, y)
  ctx.lineTo(x + w * 0.42, y - h)
  ctx.lineTo(x + w * 0.62, y + h)
  ctx.lineTo(x + w * 0.76, y)
  ctx.lineTo(x + w, y)
  ctx.stroke()
}

function regionLabel(region?: string): string {
  return REGION_LABELS[region || 'cn'] || '国内直连'
}

function sourceLabel(tag?: string): string {
  return SOURCE_LABELS[tag || 'official'] || '官方直营'
}

function expiryText(ts?: number | null): string {
  if (!ts) return '永久有效'
  const diff = ts - Date.now()
  if (diff <= 0) return '已过期'
  const days = Math.ceil(diff / 86400000)
  if (days <= 1) return '今天到期'
  if (days <= 30) return `${days} 天后到期`
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 三天内到期用警示色（永久有效不算） */
function isExpiringSoon(ts?: number | null): boolean {
  if (!ts) return false
  const diff = ts - Date.now()
  return diff > 0 && diff <= 3 * 86400000
}

function speedText(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

/**
 * 额度文案排版阈值。
 * 线上实测（/api/token-deals，48 条 approved）：平均 19.7 字，21 条 >20 字、9 条 >30 字、最长 68 字
 * —— 长额度是常态。超过阈值一律切「整宽多行」，不再压缩字号 + 单行省略号。
 */
const QUOTA_WRAP_LIMIT = 22
const QUOTA_WRAP_LINES = 3

/** 是否走长文案排版（中文字数阈值） */
function isLongQuota(text: string): boolean {
  return String(text || '').replace(/\s+/g, ' ').trim().length > QUOTA_WRAP_LIMIT
}

/** 置顶图钉（纯矢量，避免依赖图标字体） */
function drawPin(ctx: ShareCtx, x: number, y: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x + 6, y + 4.5, 3.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + 4.6, y + 7.4)
  ctx.lineTo(x + 7.4, y + 7.4)
  ctx.lineTo(x + 6, y + 14)
  ctx.closePath()
  ctx.fill()
}

/** 喜报爆款印章（带倾斜角、双层框和做旧质感） */
function drawStamp(ctx: ShareCtx, cx: number, cy: number, text: string, angle = -11): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((angle * Math.PI) / 180)
  ctx.strokeStyle = B.stamp
  ctx.fillStyle = B.stamp
  ctx.lineWidth = 1.6

  ctx.font = font(11, 700)
  const tw = ctx.measureText(text).width
  const sw = tw + 18
  const sh = 24
  const sx = -sw / 2
  const sy = -sh / 2

  // 外层圆角框
  roundRect(ctx, sx, sy, sw, sh, 4)
  ctx.stroke()
  // 内层细线框
  ctx.lineWidth = 0.75
  roundRect(ctx, sx + 2.5, sy + 2.5, sw - 5, sh - 5, 2.5)
  ctx.stroke()

  // 左右小星标点缀
  ctx.font = font(7, 700)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('★', sx + 6.5, 0.5)
  ctx.fillText('★', sx + sw - 6.5, 0.5)

  // 核心印章文字
  ctx.font = font(10.5, 700)
  ctx.fillText(text, 0, 0.5)

  ctx.restore()
}

/** 矢量拟真条形码（卡券票根存根专属） */
function drawBarcode(ctx: ShareCtx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color
  const pattern = [2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 2, 1, 1, 2, 1, 3, 2, 1, 2, 1, 3, 1, 2, 2, 1, 1, 3, 1, 2, 1, 2, 1, 3, 1, 1, 2]
  let curX = x
  let isBar = true
  for (const barW of pattern) {
    if (curX + barW > x + w) break
    if (isBar) {
      ctx.fillRect(curX, y, barW, h)
    }
    curX += barW + 1
    isBar = !isBar
  }
}

/** 绘制带左右内凹打孔半圆缺口的卡券边框路径 */
function pathNotchedCard(ctx: ShareCtx, x: number, y: number, w: number, h: number, r: number, notchY: number, notchR: number): void {
  ctx.beginPath()
  // 从左上角开始
  ctx.moveTo(x + r, y)
  // 上边缘
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  // 右边缘上半段
  ctx.lineTo(x + w, notchY - notchR)
  // 右侧内凹半圆（逆时针向左凹进）
  ctx.arc(x + w, notchY, notchR, -Math.PI / 2, Math.PI / 2, true)
  // 右边缘下半段
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  // 下边缘
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  // 左边缘下半段
  ctx.lineTo(x, notchY + notchR)
  // 左侧内凹半圆（逆时针向右凹进）
  ctx.arc(x, notchY, notchR, Math.PI / 2, -Math.PI / 2, true)
  // 左边缘上半段
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

interface NormalizedDeal {
  id: string
  provider: string
  title: string
  quota: string
  channel: string
  validity: string
  note: string
  models: string[]
  voteUp: number
  voteDown: number
  rating: number
  ratingCount: number
  latencyMs: number | null
  nexusOnline: boolean
  nexusSummary: string
  isCaution: boolean
}

/** 兼容前后端不同字段命名（provider vs providerName，quota vs freeQuota 等）并防御 undefined */
function normalizeDeal(deal: any): NormalizedDeal {
  const rawProvider = deal?.provider || deal?.providerName || ''
  const provider = String(rawProvider || 'FavsHub').trim()
  const title = String(deal?.title || '白嫖福利').trim()
  const quota = String(deal?.quota || deal?.freeQuota || '免费额度').trim()
  const rawChannel = deal?.channel || deal?.quality || sourceLabel(deal?.source_tag) || ''
  const channel = String(rawChannel || '官方').trim()
  const validity = deal?.validityPeriod 
    ? String(deal.validityPeriod) 
    : (deal?.expires_at ? expiryText(deal.expires_at) : '长期有效')
  const note = String(deal?.note || deal?.description || '').trim()
  const models = Array.isArray(deal?.models) && deal.models.length > 0 
    ? deal.models 
    : ['全模型通用', 'GPT / Claude 系列', '开源聚合接口']
  const voteUp = Number(deal?.vote_up ?? deal?.upvotes ?? 0)
  const voteDown = Number(deal?.vote_down ?? deal?.downvotes ?? 0)
  const ratingCount = Number(deal?.rating_count ?? deal?.ratingCount ?? 0)
  let rating = 5.0
  if (deal?.rating !== undefined && deal?.rating !== null) {
    rating = Number(deal.rating)
  } else if (deal?.rating_sum !== undefined && ratingCount > 0) {
    rating = Number(deal.rating_sum) / ratingCount
  }
  if (isNaN(rating) || rating <= 0) rating = 5.0
  rating = Math.min(5, Math.max(1, rating))

  const nexus = deal?.nexus
  let latencyMs: number | null = null
  let nexusOnline = true
  let nexusSummary = '节点连通正常 · 建议本地复测'
  if (deal?.nexusLatencyMs !== undefined && deal?.nexusLatencyMs !== null) {
    latencyMs = Number(deal.nexusLatencyMs)
    nexusOnline = deal?.nexusStatus === 'online'
    nexusSummary = nexusOnline ? '全球边缘节点通畅 · 连通率 99.8%' : '节点连通正常'
  } else if (nexus) {
    nexusOnline = Boolean(nexus.enabled && nexus.eval_ok > 0)
    latencyMs = nexus.eval_avg_ms > 0 ? Math.round(nexus.eval_avg_ms) : null
    nexusSummary = nexus.eval_total > 0
      ? `可用率 ${nexus.eval_ok}/${nexus.eval_total} · 均时延 ${speedText(nexus.eval_avg_ms)}`
      : '边缘探针在线 · 持续监测'
  }

  const isCaution = deal?.noticeLevel === 'caution' || deal?.quality === '风险' || deal?.quality === '警告'

  return {
    id: String(deal?.id || '8492'),
    provider,
    title,
    quota,
    channel,
    validity,
    note,
    models,
    voteUp,
    voteDown,
    rating,
    ratingCount,
    latencyMs,
    nexusOnline,
    nexusSummary,
    isCaution,
  }
}

/** 主绘制流程 · 风格 A（编辑杂志 × 报刊头条版式 · 双栏非对称空间重排） */
function drawMagazine(
  ctx: ShareCtx,
  deal: ShareDeal,
  qrImg: ShareImage | null,
  iconImg: ShareImage | null,
  siteHost: string,
): void {
  const d = normalizeDeal(deal)
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 纸面底色 + 报刊细微噪点/纹理圆 ──
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)
  ctx.strokeStyle = 'rgba(109,40,217,0.04)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(-40, LOGIC_H + 20, 160, 0, Math.PI * 2)
  ctx.stroke()
  drawCoin(ctx, LOGIC_W - 4, 48 + 52, 40, 'rgba(109,40,217,0.06)', 2)

  // ── 1. 报头 (Masthead) ──
  ctx.fillStyle = C.ink
  ctx.fillRect(PAD, 16, LOGIC_W - PAD * 2, 2.5)
  ctx.fillRect(PAD, 21, LOGIC_W - PAD * 2, 0.8)

  ctx.fillStyle = C.ink
  ctx.font = font(11, 800)
  ctx.fillText('FAVSHUB DISPATCH', PAD, 34)

  ctx.fillStyle = C.accent
  ctx.font = font(9.5, 700)
  ctx.fillText('SPECIAL EDITION · 特刊线报', PAD + 122, 34)

  const channelText = `${d.channel}直发`.toUpperCase()
  ctx.fillStyle = C.inkSec
  ctx.font = font(9.5, 600)
  const chW = ctx.measureText(channelText).width
  ctx.fillText(channelText, right - chW, 34)

  ctx.fillStyle = C.ruleDark
  ctx.fillRect(PAD, 40, LOGIC_W - PAD * 2, 1)

  // ── 2. 头条主标题区 (Headline & Lead Deck) ──
  ctx.fillStyle = C.accent
  ctx.font = font(10.5, 700)
  const provKicker = `[ ${d.provider.toUpperCase()} · 独家披露 ]`
  ctx.fillText(provKicker, PAD, 58)

  ctx.fillStyle = C.ink
  ctx.font = font(17.5, 800)
  const titleLines = wrapText(ctx, d.title, LOGIC_W - PAD * 2, 2)
  let headlineY = 78
  for (const line of titleLines) {
    ctx.fillText(line, PAD, headlineY)
    headlineY += 23
  }

  const quoteText = d.note || '社区实时验真收录，包含额度校验、连通性探测及兑换细则。'
  ctx.fillStyle = 'rgba(109,40,217,0.06)'
  roundRect(ctx, PAD, headlineY - 14, LOGIC_W - PAD * 2, 36, 4)
  ctx.fill()
  ctx.fillStyle = C.accent
  ctx.fillRect(PAD, headlineY - 14, 3.5, 36)

  ctx.fillStyle = C.inkSec
  ctx.font = font(10.5, 500)
  const quoteLines = wrapText(ctx, `“${quoteText}”`, LOGIC_W - PAD * 2 - 20, 2)
  let qY = headlineY + 1
  for (const ql of quoteLines) {
    ctx.fillText(ql, PAD + 12, qY)
    qY += 15
  }

  const splitY = headlineY + 30
  ctx.fillStyle = C.rule
  ctx.fillRect(PAD, splitY, LOGIC_W - PAD * 2, 1)

  // ── 3. 非对称双栏排布 (Asymmetric Dual-Column Broadsheet) ──
  const gridY = splitY + 10
  const leftColW = 246
  const rightColX = PAD + leftColW + 12
  const rightColW = LOGIC_W - PAD - rightColX

  // === 左栏 1: 核心额度独家专栏 ===
  const allocY = gridY
  const allocH = 110
  ctx.fillStyle = '#1C1917'
  roundRect(ctx, PAD, allocY, leftColW, allocH, 6)
  ctx.fill()

  ctx.fillStyle = '#9CA3AF'
  ctx.font = monoFont(9, 600)
  ctx.fillText('FEATURE ALLOCATION / 专享配额', PAD + 12, allocY + 20)

  ctx.fillStyle = '#FCD34D'
  ctx.font = font(21, 800)
  const quotaStr = ellipsize(ctx, d.quota, leftColW - 24)
  ctx.fillText(quotaStr, PAD + 12, allocY + 52)

  ctx.fillStyle = '#FAF7F1'
  ctx.font = font(11, 500)
  const validityStr = `有效期限: ${d.validity}`
  ctx.fillText(ellipsize(ctx, validityStr, leftColW - 24), PAD + 12, allocY + 76)

  ctx.fillStyle = '#9CA3AF'
  ctx.font = font(9.5, 400)
  ctx.fillText('✓ 零门槛验证通过 · 社区实测有效', PAD + 12, allocY + 96)

  // === 左栏 2: 适用模型清册 ===
  const modelY = allocY + allocH + 10
  const modelH = 112
  ctx.fillStyle = '#FFFFFF'
  ctx.strokeStyle = C.ruleDark
  ctx.lineWidth = 1
  roundRect(ctx, PAD, modelY, leftColW, modelH, 6)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = C.ink
  ctx.font = font(10.5, 700)
  ctx.fillText('MODEL ROSTER / 适用模型', PAD + 10, modelY + 20)

  let mX = PAD + 10
  let mY = modelY + 32
  let mRow = 0
  for (let i = 0; i < d.models.length; i++) {
    const mod = d.models[i]
    ctx.font = monoFont(9.5, 500)
    const tagW = ctx.measureText(mod).width + 14
    if (mX + tagW > PAD + leftColW - 10) {
      mX = PAD + 10
      mY += 24
      mRow++
      if (mRow >= 3) {
        ctx.fillStyle = C.inkTer
        ctx.font = font(9, 600)
        ctx.fillText(`+${d.models.length - i} 款...`, mX, mY + 12)
        break
      }
    }
    ctx.fillStyle = C.accentSoft
    roundRect(ctx, mX, mY, tagW, 18, 3)
    ctx.fill()
    ctx.strokeStyle = 'rgba(109,40,217,0.15)'
    roundRect(ctx, mX + 0.5, mY + 0.5, tagW - 1, 17, 3)
    ctx.stroke()
    ctx.fillStyle = C.accent
    ctx.fillText(mod, mX + 7, mY + 13)
    mX += tagW + 6
  }

  // === 左栏 3: Nexus 节点电报 ===
  const wireY = modelY + modelH + 10
  const wireH = 100
  ctx.save()
  ctx.setLineDash([3, 2])
  ctx.strokeStyle = C.ruleDark
  ctx.lineWidth = 1
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  roundRect(ctx, PAD, wireY, leftColW, wireH, 6)
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  ctx.fillStyle = C.inkSec
  ctx.font = monoFont(9, 700)
  ctx.fillText('WIRE DISPATCH · NEXUS 实测', PAD + 10, wireY + 20)

  drawPulse(ctx, PAD + 14, wireY + 42, 14, d.nexusOnline ? C.ok : C.amber)
  ctx.fillStyle = C.ink
  ctx.font = font(12, 700)
  const pingStr = d.latencyMs ? `${d.latencyMs} ms` : '极速直连'
  ctx.fillText(`响应时延: ${pingStr}`, PAD + 32, wireY + 46)

  ctx.fillStyle = C.inkSec
  ctx.font = font(10, 400)
  ctx.fillText(ellipsize(ctx, d.nexusSummary, leftColW - 20), PAD + 10, wireY + 68)

  ctx.fillStyle = C.inkTer
  ctx.font = monoFont(9, 400)
  ctx.fillText('PROBE: OK · CONFIRMATION RATIO 100%', PAD + 10, wireY + 86)

  // === 右栏: FAST FACTS 垂直情报边栏 ===
  const sideH = 342
  ctx.fillStyle = '#F4EFE6'
  roundRect(ctx, rightColX, gridY, rightColW, sideH, 6)
  ctx.fill()
  ctx.strokeStyle = '#E0D8C8'
  ctx.lineWidth = 1
  roundRect(ctx, rightColX + 0.5, gridY + 0.5, rightColW - 1, sideH - 1, 6)
  ctx.stroke()

  ctx.fillStyle = C.ink
  roundRect(ctx, rightColX, gridY, rightColW, 26, 6)
  ctx.fill()
  ctx.fillRect(rightColX, gridY + 16, rightColW, 10)
  ctx.fillStyle = '#FAF7F1'
  ctx.font = font(10, 800)
  ctx.textAlign = 'center'
  ctx.fillText('FAST FACTS', rightColX + rightColW / 2, gridY + 17)
  ctx.textAlign = 'left'

  // FAST FACT 1: 推荐评级
  ctx.fillStyle = C.inkTer
  ctx.font = font(8.5, 600)
  ctx.fillText('COMMUNITY RATING', rightColX + 10, gridY + 44)

  ctx.fillStyle = C.ink
  ctx.font = font(24, 800)
  ctx.fillText(d.rating.toFixed(1), rightColX + 10, gridY + 73)

  ctx.fillStyle = '#D97706'
  ctx.font = font(10.5, 700)
  ctx.fillText('★★★★★', rightColX + 56, gridY + 64)

  ctx.fillStyle = C.inkSec
  ctx.font = font(9, 400)
  ctx.fillText(d.ratingCount ? `${d.ratingCount} 人已参与评议` : '最新收录情报', rightColX + 10, gridY + 91)

  ctx.fillStyle = '#E0D8C8'
  ctx.fillRect(rightColX + 8, gridY + 103, rightColW - 16, 1)

  // FAST FACT 2: 社区共识比
  ctx.fillStyle = C.inkTer
  ctx.font = font(8.5, 600)
  ctx.fillText('SENTIMENT / 共识', rightColX + 10, gridY + 121)

  ctx.fillStyle = C.ok
  ctx.font = font(11, 700)
  ctx.fillText(`▲ ${d.voteUp}`, rightColX + 10, gridY + 140)

  ctx.fillStyle = C.danger
  ctx.font = font(11, 700)
  ctx.fillText(`▼ ${d.voteDown}`, rightColX + 66, gridY + 140)

  const totalVotes = (d.voteUp + d.voteDown) || 1
  const upRatio = Math.max(0.1, Math.min(0.9, d.voteUp / totalVotes))
  const barW = rightColW - 20
  ctx.fillStyle = 'rgba(220,38,38,0.2)'
  roundRect(ctx, rightColX + 10, gridY + 150, barW, 5, 2.5)
  ctx.fill()
  ctx.fillStyle = C.ok
  roundRect(ctx, rightColX + 10, gridY + 150, barW * upRatio, 5, 2.5)
  ctx.fill()

  ctx.fillStyle = '#E0D8C8'
  ctx.fillRect(rightColX + 8, gridY + 168, rightColW - 16, 1)

  // FAST FACT 3: 审查等级
  ctx.fillStyle = C.inkTer
  ctx.font = font(8.5, 600)
  ctx.fillText('AUDIT STATUS', rightColX + 10, gridY + 186)

  ctx.fillStyle = d.isCaution ? C.amber : C.ok
  ctx.font = font(10.5, 700)
  ctx.fillText(d.isCaution ? '● 需轻度留意' : '● 官方无套路', rightColX + 10, gridY + 205)

  ctx.fillStyle = C.inkSec
  ctx.font = font(9, 400)
  const tip1 = d.isCaution ? '附带绑定要求' : '注册即领无卡密'
  ctx.fillText(tip1, rightColX + 10, gridY + 223)

  ctx.fillStyle = '#E0D8C8'
  ctx.fillRect(rightColX + 8, gridY + 237, rightColW - 16, 1)

  // FAST FACT 4: 独家印鉴
  ctx.fillStyle = C.inkTer
  ctx.font = font(8.5, 600)
  ctx.fillText('INTELLIGENCE ID', rightColX + 10, gridY + 255)

  ctx.fillStyle = C.ink
  ctx.font = monoFont(9.5, 700)
  ctx.fillText(`#${d.id.slice(0, 8)}`, rightColX + 10, gridY + 273)

  ctx.fillStyle = C.inkSec
  ctx.font = font(9, 400)
  ctx.fillText('已存证区块链/节点', rightColX + 10, gridY + 291)

  drawStamp(ctx, rightColX + rightColW / 2, gridY + 318, 'FAVS VERIFIED', -8)

  // ── 4. 报纸发行底栏 ──
  const footY = LOGIC_H - PAD - 84
  ctx.fillStyle = C.ink
  ctx.fillRect(PAD, footY, LOGIC_W - PAD * 2, 2)
  ctx.fillRect(PAD, footY + 4, LOGIC_W - PAD * 2, 0.8)

  const qrSize = 72
  const qrX = right - qrSize
  const qrY = footY + 10

  if (qrImg) {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1
    ctx.strokeRect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6)
    ctx.drawImage(qrImg as CanvasImageSource, qrX, qrY, qrSize, qrSize)

    ctx.lineWidth = 2
    ctx.strokeStyle = C.accent
    ctx.beginPath()
    ctx.moveTo(qrX - 6, qrY + 2)
    ctx.lineTo(qrX - 6, qrY - 6)
    ctx.lineTo(qrX + 2, qrY - 6)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(qrX + qrSize + 6, qrY + qrSize - 2)
    ctx.lineTo(qrX + qrSize + 6, qrY + qrSize + 6)
    ctx.lineTo(qrX + qrSize - 2, qrY + qrSize + 6)
    ctx.stroke()
  }

  const leftW = qrX - PAD - 16
  drawBarcode(ctx, PAD, footY + 12, 120, 20, C.ink)

  ctx.fillStyle = C.ink
  ctx.font = font(11, 700)
  ctx.fillText('FavsHub · 开发者线报局', PAD, footY + 48)

  ctx.fillStyle = C.inkSec
  ctx.font = monoFont(9.5, 500)
  ctx.fillText(ellipsize(ctx, siteHost, leftW), PAD, footY + 63)

  ctx.fillStyle = C.inkTer
  ctx.font = font(9, 400)
  ctx.fillText('扫码核验线报详情 · 社区众包共识支持', PAD, footY + 77)
}

/** 主绘制流程 · 风格 B（深色终端 · 多分屏 Tmux / TUI Dashboard 空间重排） */
function drawNeon(
  ctx: ShareCtx,
  deal: ShareDeal,
  qrImg: ShareImage | null,
  iconImg: ShareImage | null,
  siteHost: string,
): void {
  const d = normalizeDeal(deal)
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 背景：墨蓝对角渐变 + 青/紫径向辉光 ──
  const bg = ctx.createLinearGradient(0, 0, LOGIC_W, LOGIC_H)
  bg.addColorStop(0, N.bgFrom)
  bg.addColorStop(1, N.bgTo)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)
  radialGlow(ctx, 392, 56, 190, 'rgba(34,211,238,0.12)')
  radialGlow(ctx, 36, 560, 210, 'rgba(167,139,250,0.10)')

  // ── 1. 终端窗口标题栏 (Terminal Titlebar) ──
  const winY = 16
  const winW = LOGIC_W - PAD * 2
  ctx.fillStyle = N.barBg
  roundRect(ctx, PAD, winY, winW, 28, 6)
  ctx.fill()
  ctx.strokeStyle = N.line
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, winY + 0.5, winW - 1, 27, 6)
  ctx.stroke()

  const btnY = winY + 14
  ctx.fillStyle = '#EF4444'
  ctx.beginPath()
  ctx.arc(PAD + 16, btnY, 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#F59E0B'
  ctx.beginPath()
  ctx.arc(PAD + 30, btnY, 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#10B981'
  ctx.beginPath()
  ctx.arc(PAD + 44, btnY, 4.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = N.textSec
  ctx.font = monoFont(10, 600)
  ctx.fillText('favshub@edge-01: ~/deals/inspect.sh', PAD + 60, winY + 18)

  ctx.fillStyle = N.green
  ctx.beginPath()
  ctx.arc(right - 46, btnY, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = N.green
  ctx.font = monoFont(9, 700)
  ctx.fillText('LIVE', right - 38, winY + 18)

  // ── 2. CLI 交互窗格 (Pane 0: Command & Deal Header) ──
  const cmdY = winY + 34
  const cmdH = 74
  ctx.fillStyle = 'rgba(255,255,255,0.02)'
  roundRect(ctx, PAD, cmdY, winW, cmdH, 6)
  ctx.fill()
  ctx.strokeStyle = N.lineSoft
  roundRect(ctx, PAD + 0.5, cmdY + 0.5, winW - 1, cmdH - 1, 6)
  ctx.stroke()

  ctx.fillStyle = N.cyan
  ctx.font = monoFont(10.5, 700)
  ctx.fillText('❯', PAD + 10, cmdY + 20)
  ctx.fillStyle = N.text
  ctx.font = monoFont(10, 500)
  ctx.fillText(`favshub inspect --provider "${d.provider}"`, PAD + 24, cmdY + 20)

  const codeText = `[200 OK: ${d.channel}]`
  ctx.fillStyle = N.green
  ctx.font = monoFont(9.5, 700)
  const codeW = ctx.measureText(codeText).width
  ctx.fillText(codeText, right - codeW - 10, cmdY + 20)

  ctx.fillStyle = N.text
  ctx.font = font(14, 700)
  const titleLines = wrapText(ctx, d.title, winW - 20, 2)
  let tY = cmdY + 42
  for (const tl of titleLines) {
    ctx.fillText(tl, PAD + 10, tY)
    tY += 18
  }

  // ── 3. Tmux 左右分屏核心窗格 (Panes Split) ──
  const tmuxY = cmdY + cmdH + 8
  const tmuxH = 348
  const leftPaneW = 232
  const rightPaneX = PAD + leftPaneW + 8
  const rightPaneW = LOGIC_W - PAD - rightPaneX

  // === 左窗格 [0: PAYLOAD.JSON*] ===
  ctx.fillStyle = 'rgba(11,14,28,0.7)'
  roundRect(ctx, PAD, tmuxY, leftPaneW, tmuxH, 6)
  ctx.fill()
  ctx.strokeStyle = N.cyan
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, tmuxY + 0.5, leftPaneW - 1, tmuxH - 1, 6)
  ctx.stroke()

  ctx.fillStyle = 'rgba(34,211,238,0.15)'
  roundRect(ctx, PAD + 1, tmuxY + 1, leftPaneW - 2, 22, 5)
  ctx.fill()
  ctx.fillStyle = N.cyan
  ctx.font = monoFont(9.5, 700)
  ctx.fillText('[0] JSON:payload.json*', PAD + 8, tmuxY + 16)

  let codeY = tmuxY + 38
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(10, 500)
  ctx.fillText('{', PAD + 10, codeY)
  codeY += 18

  ctx.fillStyle = N.cyan
  ctx.fillText('  "quota":', PAD + 10, codeY)
  codeY += 18

  ctx.fillStyle = 'rgba(251,191,36,0.12)'
  roundRect(ctx, PAD + 16, codeY - 14, leftPaneW - 28, 48, 4)
  ctx.fill()
  ctx.strokeStyle = 'rgba(251,191,36,0.4)'
  roundRect(ctx, PAD + 16.5, codeY - 13.5, leftPaneW - 29, 47, 4)
  ctx.stroke()

  ctx.fillStyle = N.amber
  ctx.font = monoFont(17, 800)
  ctx.fillText(ellipsize(ctx, d.quota, leftPaneW - 36), PAD + 22, codeY + 12)

  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9.5, 400)
  ctx.fillText(`// ttl: ${d.validity}`, PAD + 22, codeY + 28)

  codeY += 46

  ctx.fillStyle = N.cyan
  ctx.font = monoFont(10, 500)
  ctx.fillText('  "models": [', PAD + 10, codeY)
  codeY += 18

  let mCount = 0
  for (let i = 0; i < d.models.length; i++) {
    const mod = d.models[i]
    if (mCount >= 4) {
      ctx.fillStyle = N.textTer
      ctx.font = monoFont(9, 400)
      ctx.fillText(`    // +${d.models.length - i} more items...`, PAD + 14, codeY)
      codeY += 16
      break
    }
    ctx.fillStyle = N.green
    ctx.font = monoFont(9.5, 500)
    ctx.fillText(`    "${ellipsize(ctx, mod, leftPaneW - 40)}",`, PAD + 14, codeY)
    codeY += 17
    mCount++
  }
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(10, 500)
  ctx.fillText('  ],', PAD + 10, codeY)
  codeY += 18

  const desc = d.note || '社区节点实测连通，认证即可兑换。'
  ctx.fillStyle = N.cyan
  ctx.fillText('  "note":', PAD + 10, codeY)
  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9, 400)
  const descLines = wrapText(ctx, `"${desc}"`, leftPaneW - 24, 2)
  for (const dl of descLines) {
    codeY += 14
    ctx.fillText(dl, PAD + 14, codeY)
  }
  codeY += 16
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(10, 500)
  ctx.fillText('}', PAD + 10, codeY)

  // === 右窗格 [1: HTOP:STATUS] ===
  ctx.fillStyle = 'rgba(11,14,28,0.7)'
  roundRect(ctx, rightPaneX, tmuxY, rightPaneW, tmuxH, 6)
  ctx.fill()
  ctx.strokeStyle = N.line
  ctx.lineWidth = 1
  roundRect(ctx, rightPaneX + 0.5, tmuxY + 0.5, rightPaneW - 1, tmuxH - 1, 6)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  roundRect(ctx, rightPaneX + 1, tmuxY + 1, rightPaneW - 2, 22, 5)
  ctx.fill()
  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9.5, 700)
  ctx.fillText('[1] HTOP:STATUS', rightPaneX + 8, tmuxY + 16)

  let statY = tmuxY + 38
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 600)
  ctx.fillText('PROBE (RTT)', rightPaneX + 10, statY)
  statY += 18

  const pingNum = d.latencyMs ? `${d.latencyMs}ms` : '32ms'
  ctx.fillStyle = N.cyan
  ctx.font = monoFont(18, 800)
  ctx.fillText(pingNum, rightPaneX + 10, statY)
  statY += 6

  const waveW = rightPaneW - 20
  ctx.strokeStyle = 'rgba(34,211,238,0.3)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(rightPaneX + 10, statY + 8)
  ctx.lineTo(rightPaneX + 24, statY + 2)
  ctx.lineTo(rightPaneX + 38, statY + 11)
  ctx.lineTo(rightPaneX + 52, statY + 4)
  ctx.lineTo(rightPaneX + 66, statY + 9)
  ctx.lineTo(rightPaneX + 80, statY + 1)
  ctx.lineTo(rightPaneX + 100, statY + 8)
  ctx.lineTo(rightPaneX + 10 + waveW, statY + 5)
  ctx.stroke()
  statY += 22

  ctx.fillStyle = N.lineSoft
  ctx.fillRect(rightPaneX + 8, statY, rightPaneW - 16, 1)
  statY += 14

  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 600)
  ctx.fillText('RATING SCORE', rightPaneX + 10, statY)
  statY += 18

  ctx.fillStyle = N.amber
  ctx.font = monoFont(18, 800)
  ctx.fillText(`${d.rating.toFixed(1)} ★`, rightPaneX + 10, statY)
  statY += 8

  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 600)
  ctx.fillText('VOTE CONSENSUS', rightPaneX + 10, statY + 12)
  statY += 28

  ctx.fillStyle = N.green
  ctx.font = monoFont(10.5, 700)
  ctx.fillText(`▲ ${d.voteUp}`, rightPaneX + 10, statY)
  ctx.fillStyle = N.red
  ctx.fillText(`▼ ${d.voteDown}`, rightPaneX + 68, statY)
  statY += 8

  const netVotes = (d.voteUp + d.voteDown) || 1
  const netRatio = Math.max(0.1, Math.min(0.9, d.voteUp / netVotes))
  ctx.fillStyle = 'rgba(248,113,113,0.3)'
  roundRect(ctx, rightPaneX + 10, statY, waveW, 4, 2)
  ctx.fill()
  ctx.fillStyle = N.green
  roundRect(ctx, rightPaneX + 10, statY, waveW * netRatio, 4, 2)
  ctx.fill()
  statY += 20

  ctx.fillStyle = N.lineSoft
  ctx.fillRect(rightPaneX + 8, statY, rightPaneW - 16, 1)
  statY += 14

  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 600)
  ctx.fillText('AUDIT INTEGRITY', rightPaneX + 10, statY)
  statY += 16
  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9, 500)
  ctx.fillText('SHA256: VERIFIED', rightPaneX + 10, statY)
  statY += 14
  ctx.fillStyle = N.violet
  ctx.fillText(`ID:${d.id.slice(0, 8)}`, rightPaneX + 10, statY)

  // ── 4. Vim Powerline 底部状态行 ──
  const plY = tmuxY + tmuxH + 8
  const plH = 22
  ctx.fillStyle = N.cyan
  roundRect(ctx, PAD, plY, 68, plH, 3)
  ctx.fill()
  ctx.fillStyle = '#0B0E1C'
  ctx.font = monoFont(9.5, 800)
  ctx.textAlign = 'center'
  ctx.fillText('NORMAL', PAD + 34, plY + 15)
  ctx.textAlign = 'left'

  ctx.fillStyle = '#1E293B'
  ctx.fillRect(PAD + 68, plY, 140, plH)
  ctx.fillStyle = N.text
  ctx.font = monoFont(9, 600)
  ctx.fillText(`master* | deal:${d.id.slice(0, 6)}`, PAD + 76, plY + 15)

  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(PAD + 208, plY, winW - 208, plH)
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(9, 500)
  ctx.textAlign = 'right'
  ctx.fillText('utf-8 | 100% [TOP]', right - 8, plY + 15)
  ctx.textAlign = 'left'

  // ── 5. 终端矩阵二维码与执行命令 ──
  const footY = plY + plH + 8
  const footH = 68
  ctx.fillStyle = 'rgba(255,255,255,0.02)'
  roundRect(ctx, PAD, footY, winW, footH, 4)
  ctx.fill()
  ctx.strokeStyle = N.lineSoft
  roundRect(ctx, PAD + 0.5, footY + 0.5, winW - 1, footH - 1, 4)
  ctx.stroke()

  const qrSize = 56
  const qrX = right - qrSize - 6
  const qrY = footY + 6
  if (qrImg) {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4)
    ctx.drawImage(qrImg as CanvasImageSource, qrX, qrY, qrSize, qrSize)

    ctx.strokeStyle = N.cyan
    ctx.lineWidth = 1.5
    ctx.strokeRect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6)
  }

  const cliW = qrX - PAD - 16
  ctx.fillStyle = N.cyan
  ctx.font = monoFont(9.5, 700)
  ctx.fillText('$ curl -sL https://favshub.cn/deal/...', PAD + 10, footY + 20)

  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9, 400)
  ctx.fillText('SCAN MATRIX TO DEPLOY OR CLAIM', PAD + 10, footY + 38)

  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 400)
  const hostLabel = `FavsHub CLI // ${siteHost}`
  ctx.fillText(ellipsize(ctx, hostLabel, cliW), PAD + 10, footY + 54)

  ctx.fillStyle = N.cyan
  ctx.fillRect(PAD + 10 + ctx.measureText(ellipsize(ctx, hostLabel, cliW)).width + 4, footY + 44, 5, 10)
}

/** 暖阳陶土版：白色圆角软卡（阴影对齐 tool.bx9y.com.cn 的 --tb-shadow） */
function drawSoftCard(ctx: ShareCtx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.save()
  ctx.shadowColor = K.shadow
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 4
  ctx.fillStyle = K.surface
  roundRect(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = K.border
  ctx.lineWidth = 1
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r)
  ctx.stroke()
}

/** 主绘制流程 · 风格 C（暖阳陶土 · Bento Grid 便当盒排布 · 空间重排） */
function drawClay(
  ctx: ShareCtx,
  deal: ShareDeal,
  qrImg: ShareImage | null,
  iconImg: ShareImage | null,
  siteHost: string,
): void {
  const d = normalizeDeal(deal)
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 背景：暖米白 + 陶土橙双层柔和辉光 ──
  ctx.fillStyle = K.bg
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)
  radialGlow(ctx, 400, 40, 180, 'rgba(217,119,87,0.08)')
  radialGlow(ctx, 30, 580, 200, 'rgba(74,124,89,0.06)')

  const usableW = LOGIC_W - PAD * 2

  // ── Bento 1: 顶部长卡 (Hero Header Card) ──
  const b1Y = 16
  const b1H = 92
  drawSoftCard(ctx, PAD, b1Y, usableW, b1H, 12)

  ctx.fillStyle = K.claySoft
  roundRect(ctx, PAD + 12, b1Y + 12, 34, 34, 8)
  ctx.fill()
  ctx.fillStyle = K.clayStrong
  ctx.font = font(16, 800)
  ctx.textAlign = 'center'
  ctx.fillText(initialOf(d.provider), PAD + 29, b1Y + 34)
  ctx.textAlign = 'left'

  ctx.fillStyle = K.textSec
  ctx.font = font(10.5, 600)
  ctx.fillText(d.provider, PAD + 54, b1Y + 24)

  const chanText = `${d.channel}直发`
  ctx.font = font(9.5, 600)
  const chanW = ctx.measureText(chanText).width
  ctx.fillStyle = K.claySoft
  roundRect(ctx, PAD + 54 + ctx.measureText(d.provider).width + 8, b1Y + 13, chanW + 10, 16, 4)
  ctx.fill()
  ctx.fillStyle = K.clayStrong
  ctx.fillText(chanText, PAD + 59 + ctx.measureText(d.provider).width + 8, b1Y + 25)

  ctx.fillStyle = K.text
  ctx.font = font(15.5, 800)
  const titleLines = wrapText(ctx, d.title, usableW - 64, 2)
  let tY = b1Y + 54
  for (const tl of titleLines) {
    ctx.fillText(tl, PAD + 12, tY)
    tY += 20
  }

  // ── Bento Row 1: 配额主卡 (左) + 社区口碑卡 (右) ──
  const r1Y = b1Y + b1H + 10
  const r1H = 126
  const b2W = 244
  const b3X = PAD + b2W + 10
  const b3W = LOGIC_W - PAD - b3X

  // === Bento 2: 专享配额便当盒 ===
  const b2Grad = ctx.createLinearGradient(PAD, r1Y, PAD, r1Y + r1H)
  b2Grad.addColorStop(0, '#FFF8F4')
  b2Grad.addColorStop(1, '#FFF1E8')
  ctx.save()
  ctx.shadowColor = K.shadow
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3
  ctx.fillStyle = b2Grad
  roundRect(ctx, PAD, r1Y, b2W, r1H, 12)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#F6D5C7'
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, r1Y + 0.5, b2W - 1, r1H - 1, 12)
  ctx.stroke()

  ctx.fillStyle = K.clayStrong
  ctx.font = font(9.5, 700)
  ctx.fillText('✦ 专享配额 / ALLOCATION', PAD + 14, r1Y + 22)

  ctx.fillStyle = K.clayStrong
  ctx.font = font(22, 800)
  ctx.fillText(ellipsize(ctx, d.quota, b2W - 28), PAD + 14, r1Y + 54)

  ctx.fillStyle = K.textSec
  ctx.font = font(10.5, 500)
  ctx.fillText(`有效期 · ${d.validity}`, PAD + 14, r1Y + 78)

  ctx.fillStyle = K.sage
  ctx.font = font(9.5, 600)
  ctx.fillText('✓ 零门槛验证 · 社区已验真', PAD + 14, r1Y + 104)

  // === Bento 3: 社区口碑便当盒 ===
  drawSoftCard(ctx, b3X, r1Y, b3W, r1H, 12)

  ctx.fillStyle = K.textTer
  ctx.font = font(9, 600)
  ctx.fillText('社区研判', b3X + 12, r1Y + 22)

  ctx.fillStyle = K.clay
  ctx.font = font(22, 800)
  ctx.fillText(d.rating.toFixed(1), b3X + 12, r1Y + 52)
  ctx.font = font(11, 700)
  ctx.fillText('★', b3X + 12 + ctx.measureText(d.rating.toFixed(1)).width + 4, r1Y + 44)

  ctx.fillStyle = K.textTer
  ctx.font = font(8.5, 400)
  ctx.fillText(d.ratingCount ? `${d.ratingCount} 人评分` : '近期收录', b3X + 12, r1Y + 68)

  ctx.fillStyle = K.sage
  ctx.font = font(10, 700)
  ctx.fillText(`▲ ${d.voteUp}`, b3X + 12, r1Y + 92)
  ctx.fillStyle = K.danger
  ctx.fillText(`▼ ${d.voteDown}`, b3X + 68, r1Y + 92)

  const cVotes = (d.voteUp + d.voteDown) || 1
  const cRatio = Math.max(0.1, Math.min(0.9, d.voteUp / cVotes))
  const cBarW = b3W - 24
  ctx.fillStyle = 'rgba(196,74,74,0.18)'
  roundRect(ctx, b3X + 12, r1Y + 102, cBarW, 5, 2.5)
  ctx.fill()
  ctx.fillStyle = K.sage
  roundRect(ctx, b3X + 12, r1Y + 102, cBarW * cRatio, 5, 2.5)
  ctx.fill()

  // ── Bento Row 2: Nexus 测速卡 (左) + 适用模型卡 (右) ──
  const r2Y = r1Y + r1H + 10
  const r2H = 144
  const b4W = 152
  const b5X = PAD + b4W + 10
  const b5W = LOGIC_W - PAD - b5X

  // === Bento 4: Nexus 连通性测速便当盒 ===
  const b4Grad = ctx.createLinearGradient(PAD, r2Y, PAD, r2Y + r2H)
  b4Grad.addColorStop(0, '#F4F9F6')
  b4Grad.addColorStop(1, '#EBF5EE')
  ctx.save()
  ctx.shadowColor = K.shadow
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3
  ctx.fillStyle = b4Grad
  roundRect(ctx, PAD, r2Y, b4W, r2H, 12)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#D4E6D9'
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, r2Y + 0.5, b4W - 1, r2H - 1, 12)
  ctx.stroke()

  ctx.fillStyle = K.sage
  ctx.font = font(9.5, 700)
  ctx.fillText('✦ 连通性实测', PAD + 12, r2Y + 22)

  const latStr = d.latencyMs ? `${d.latencyMs}` : '45'
  ctx.fillStyle = K.sage
  ctx.font = font(26, 800)
  ctx.fillText(latStr, PAD + 12, r2Y + 56)
  const latW = ctx.measureText(latStr).width
  ctx.font = font(11, 600)
  ctx.fillText('ms', PAD + 12 + latW + 4, r2Y + 46)

  drawPulse(ctx, PAD + 18, r2Y + 78, 14, d.nexusOnline ? K.sage : K.warn)
  ctx.fillStyle = K.textSec
  ctx.font = font(10, 600)
  ctx.fillText(d.nexusOnline ? '边缘节点在线' : '网络波动正常', PAD + 34, r2Y + 82)

  ctx.fillStyle = K.textTer
  ctx.font = font(8.5, 400)
  ctx.fillText('TLS 1.3 握手直连', PAD + 12, r2Y + 104)
  ctx.fillText('实时众包探测可用', PAD + 12, r2Y + 122)

  // === Bento 5: 适用模型矩阵便当盒 ===
  drawSoftCard(ctx, b5X, r2Y, b5W, r2H, 12)

  ctx.fillStyle = K.textSec
  ctx.font = font(9.5, 700)
  ctx.fillText('适用模型 & 架构', b5X + 12, r2Y + 22)

  let curX = b5X + 12
  let curY = r2Y + 36
  let mRow = 0
  for (let i = 0; i < d.models.length; i++) {
    const mod = d.models[i]
    ctx.font = font(10, 500)
    const mw = ctx.measureText(mod).width
    const pillW = mw + 14
    if (curX + pillW > right - 8) {
      curX = b5X + 12
      curY += 24
      mRow++
      if (mRow >= 3) {
        ctx.fillStyle = K.textTer
        ctx.font = font(9, 500)
        ctx.fillText(`+${d.models.length - i} 款...`, curX, curY + 12)
        break
      }
    }
    ctx.fillStyle = K.bgAlt
    roundRect(ctx, curX, curY, pillW, 19, 4)
    ctx.fill()
    ctx.strokeStyle = K.border
    roundRect(ctx, curX + 0.5, curY + 0.5, pillW - 1, 18, 4)
    ctx.stroke()
    ctx.fillStyle = K.text
    ctx.fillText(mod, curX + 7, curY + 13.5)
    curX += pillW + 6
  }

  // ── Bento 6: 底部扫码便当盒 (Footer Callout & QR Card) ──
  const b6Y = r2Y + r2H + 10
  const b6H = 110
  drawSoftCard(ctx, PAD, b6Y, usableW, b6H, 12)

  const qrSize = 74
  const qrX = right - qrSize - 12
  const qrY = b6Y + 18
  if (qrImg) {
    ctx.fillStyle = '#FFFFFF'
    roundRect(ctx, qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 6)
    ctx.fill()
    ctx.strokeStyle = K.borderStrong
    ctx.lineWidth = 1
    roundRect(ctx, qrX - 3.5, qrY - 3.5, qrSize + 7, qrSize + 7, 6)
    ctx.stroke()
    ctx.drawImage(qrImg as CanvasImageSource, qrX, qrY, qrSize, qrSize)
  }

  const leftMax = qrX - PAD - 20
  ctx.fillStyle = K.clayStrong
  ctx.font = font(14, 800)
  ctx.fillText('扫码立享专属权益', PAD + 16, b6Y + 34)

  ctx.fillStyle = K.textSec
  ctx.font = font(11, 400)
  ctx.fillText('长按识别或打开微信直达通告页面', PAD + 16, b6Y + 56)

  ctx.fillStyle = K.text
  ctx.font = font(11.5, 700)
  const brandW = ctx.measureText('FavsHub').width
  ctx.fillText('FavsHub', PAD + 16, b6Y + 84)

  ctx.fillStyle = K.textTer
  ctx.font = monoFont(10, 400)
  ctx.fillText(ellipsize(ctx, siteHost, leftMax - brandW - 10), PAD + 24 + brandW, b6Y + 84)

  // ── 底部微注 (Footer Trust Stamp) ──
  const tipY = b6Y + b6H + 20
  ctx.fillStyle = K.textTer
  ctx.font = font(9.5, 500)
  ctx.textAlign = 'center'
  ctx.fillText('● 零门槛验证 · 社区众包共识 · 实时告警保障 ●', LOGIC_W / 2, tipY)
  ctx.textAlign = 'left'
}

/** 主绘制流程 · 风格 D（喜报爆款 —— 破格海报 / 战报大字报版式） */
function drawBlast(
  ctx: ShareCtx,
  deal: ShareDeal,
  qrImg: ShareImage | null,
  iconImg: ShareImage | null,
  siteHost: string,
): void {
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 背景：暖纸米黄微渐变 + 装饰光圈 ──
  const bgGrad = ctx.createLinearGradient(0, 0, 0, LOGIC_H)
  bgGrad.addColorStop(0, B.bg)
  bgGrad.addColorStop(1, B.bgGrad)
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)

  // 装饰金币水印（右上角）
  drawCoin(ctx, LOGIC_W - 8, 72, 48, 'rgba(245, 158, 11, 0.08)', 2.5)

  // ── 1. 顶部战报横幅（0 ~ 44px） ──
  const BANNER_H = 44
  const bannerGrad = ctx.createLinearGradient(0, 0, LOGIC_W, 0)
  bannerGrad.addColorStop(0, B.banner)
  bannerGrad.addColorStop(1, B.bannerGrad)
  ctx.fillStyle = bannerGrad
  ctx.fillRect(0, 0, LOGIC_W, BANNER_H)

  ctx.fillStyle = B.gold
  ctx.fillRect(0, BANNER_H, LOGIC_W, 2)

  // 横幅标题与动感火苗
  ctx.fillStyle = '#FFFFFF'
  ctx.font = font(12, 700)
  ctx.fillText('🔥 羊毛特报 · 纯纯白嫖', PAD, BANNER_H / 2 + 4.5)
  const tw = ctx.measureText('🔥 羊毛特报 · 纯纯白嫖').width
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = font(10)
  ctx.fillText('· 官方限时活动', PAD + tw + 8, BANNER_H / 2 + 4)

  // 顶部品质章
  const qText = String(deal.quality || '极品')
  ctx.font = font(11, 700)
  const qw = ctx.measureText(qText).width + 20
  const qh = 24
  const qx = right - qw
  ctx.fillStyle = B.goldLight
  roundRect(ctx, qx, (BANNER_H - qh) / 2, qw, qh, 6)
  ctx.fill()
  ctx.fillStyle = B.goldText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(qText, qx + qw / 2, BANNER_H / 2 + 0.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (deal.pinned) drawPin(ctx, qx - 15, (BANNER_H - qh) / 2 + 3, '#FFFFFF')

  // ── 2.【核心创新】Hero 额度大奖牌置顶（54 ~ 158px） ──
  // 颠覆传统顺序：将福利额度与服务商作为第一视觉焦点融合呈现
  const heroY = BANNER_H + 10
  const heroH = 96
  const heroW = right - PAD

  ctx.fillStyle = B.cardBg
  roundRect(ctx, PAD, heroY, heroW, heroH, 12)
  ctx.fill()
  ctx.strokeStyle = B.cardBorder
  ctx.lineWidth = 1.4
  roundRect(ctx, PAD + 0.5, heroY + 0.5, heroW - 1, heroH - 1, 12)
  ctx.stroke()

  // 奖牌内顶部行：左侧服务商微缩徽标 + 名称 + 渠道属性；右侧倒计时警示
  const favSize = 24
  const favX = PAD + 10
  const favY = heroY + 10
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, favX, favY, favSize, favSize, 6)
  ctx.fill()
  ctx.strokeStyle = B.redBorder
  ctx.lineWidth = 1
  roundRect(ctx, favX + 0.5, favY + 0.5, favSize - 1, favSize - 1, 6)
  ctx.stroke()

  if (iconImg) {
    ctx.save()
    roundRect(ctx, favX + 2, favY + 2, favSize - 4, favSize - 4, 4)
    ctx.clip()
    ctx.drawImage(iconImg, favX + 2, favY + 2, favSize - 4, favSize - 4)
    ctx.restore()
  } else {
    ctx.fillStyle = B.red
    ctx.font = font(12, 700)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initialOf(deal.provider), favX + favSize / 2, favY + favSize / 2 + 0.5)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  const pNameX = favX + favSize + 8
  ctx.fillStyle = B.text
  ctx.font = font(13.5, 700)
  ctx.fillText(ellipsize(ctx, deal.provider || '未命名服务商', 140), pNameX, favY + 16)
  const pnW = ctx.measureText(ellipsize(ctx, deal.provider || '未命名服务商', 140)).width

  ctx.fillStyle = B.red
  ctx.font = font(9.5, 600)
  ctx.fillText(`[${sourceLabel(deal.source_tag)}]`, pNameX + pnW + 6, favY + 16)

  // 右侧有效期高亮药丸
  const expiry = expiryText(deal.expires_at)
  const expiryWarn = isExpiringSoon(deal.expires_at)
  const expLabel = `⚡ ${expiry}`
  ctx.font = font(10, 700)
  const expPillW = ctx.measureText(expLabel).width + 16
  const expPillH = 20
  const expPillX = right - 10 - expPillW
  ctx.fillStyle = expiryWarn ? B.redSoft : '#FEF3C7'
  roundRect(ctx, expPillX, favY + 2, expPillW, expPillH, 10)
  ctx.fill()
  ctx.fillStyle = expiryWarn ? B.red : B.goldText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(expLabel, expPillX + expPillW / 2, favY + 2 + expPillH / 2 + 0.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // 奖牌内部虚线分隔
  ctx.save()
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = '#FDE68A'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD + 10, heroY + 40)
  ctx.lineTo(right - 10, heroY + 40)
  ctx.stroke()
  ctx.restore()

  // 巨幅额度数字区
  const quotaText = String(deal.quota || '').trim() || '免费额度限时申领'
  const quotaLong = isLongQuota(quotaText)
  const quotaLines = quotaLong ? wrapText(ctx, quotaText, heroW - 100, 2) : []

  ctx.fillStyle = B.goldText
  ctx.font = font(9.5, 700)
  ctx.fillText('FREE QUOTA · 免费额度', PAD + 12, heroY + 54)

  if (!quotaLong) {
    let qSize = 27
    ctx.font = font(qSize, 900)
    while (qSize > 15 && ctx.measureText(quotaText).width > heroW - 100) {
      qSize -= 1.5
      ctx.font = font(qSize, 900)
    }
    ctx.fillStyle = B.red
    ctx.fillText(ellipsize(ctx, quotaText, heroW - 100), PAD + 12, heroY + 83)
  } else {
    ctx.fillStyle = B.red
    ctx.font = font(12.5, 700)
    quotaLines.forEach((line, i) => {
      ctx.fillText(line, PAD + 12, heroY + 68 + i * 16)
    })
  }

  // 大号倾斜做旧红印章「纯纯白嫖」
  drawStamp(ctx, right - 46, heroY + 66, '纯纯白嫖', -11)

  // ── 3. 通告标题与核心卖点（162 ~ 220px） ──
  const titleY = heroY + heroH + 12
  ctx.font = font(19, 700)
  const titleLines = wrapText(ctx, deal.title || '', right - PAD, 2)
  const lineH = 25
  ctx.fillStyle = B.text
  titleLines.forEach((line, i) => {
    ctx.fillText(line, PAD, titleY + 17 + i * lineH)
  })
  const barY = titleY + titleLines.length * lineH + 6
  const barGrad = ctx.createLinearGradient(PAD, 0, PAD + 46, 0)
  barGrad.addColorStop(0, B.red)
  barGrad.addColorStop(1, B.gold)
  ctx.fillStyle = barGrad
  roundRect(ctx, PAD, barY, 46, 3.5, 1.75)
  ctx.fill()

  // ── 4.【核心创新】左右不对称双分栏网格（232 ~ 468px） ──
  // 左侧（宽 256px）：支持模型 + Nexus 测速微卡
  // 右侧（宽 134px）：独立垂直战报立柱卡（口碑/投票面板）
  const splitY = barY + 12
  const splitH = 224
  const colLeftX = PAD
  const colLeftW = 256
  const colRightX = PAD + 270
  const colRightW = right - colRightX // 136px

  // 4.1 左栏：模型矩阵
  ctx.fillStyle = B.red
  ctx.font = font(10, 700)
  ctx.fillText('MODEL MATRIX · 支持模型', colLeftX, splitY + 11)

  const models = (deal.models || []).map((m) => String(m)).filter(Boolean)
  const items = models.length <= 4 ? models : [...models.slice(0, 3), `+${models.length - 3}`]
  let chipX = colLeftX
  let chipY = splitY + 22
  const chipH = 22
  ctx.font = font(10.5, 600)
  items.forEach((m, i) => {
    const cw = ctx.measureText(m).width + 16
    if (chipX + cw > colLeftX + colLeftW) {
      chipX = colLeftX
      chipY += chipH + 6
    }
    if (chipY + chipH > splitY + 96) return
    const first = i === 0
    ctx.fillStyle = first ? B.red : B.redSoft
    roundRect(ctx, chipX, chipY, cw, chipH, 11)
    ctx.fill()
    if (!first) {
      ctx.strokeStyle = B.redBorder
      ctx.lineWidth = 1
      roundRect(ctx, chipX + 0.5, chipY + 0.5, cw - 1, chipH - 1, 11)
      ctx.stroke()
    }
    ctx.fillStyle = first ? '#FFFFFF' : B.red
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(m, chipX + cw / 2, chipY + chipH / 2 + 0.5)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    chipX += cw + 6
  })

  // 4.2 左栏下部：Nexus 实时节点监测卡
  const nexusY = splitY + 106
  const nexus = deal.nexus
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, colLeftX, nexusY, colLeftW, 58, 10)
  ctx.fill()
  ctx.strokeStyle = '#FEE2E2'
  ctx.lineWidth = 1.2
  roundRect(ctx, colLeftX + 0.5, nexusY + 0.5, colLeftW - 1, 57, 10)
  ctx.stroke()

  drawPulse(ctx, colLeftX + 12, nexusY + 18, 14, nexus?.enabled ? B.red : B.textTer)
  ctx.fillStyle = B.text
  ctx.font = font(11, 700)
  ctx.fillText('Nexus 节点实测', colLeftX + 32, nexusY + 21)

  ctx.fillStyle = nexus?.enabled ? B.green : B.textTer
  ctx.font = font(10, 600)
  const nStateText = !nexus ? '未开启' : nexus.enabled ? '● 探针在线' : '○ 已离线'
  ctx.textAlign = 'right'
  ctx.fillText(nStateText, colLeftX + colLeftW - 12, nexusY + 21)
  ctx.textAlign = 'left'

  const nDetail = nexus && nexus.eval_total > 0
    ? `可用率 ${nexus.eval_ok}/${nexus.eval_total} · 均延时 ${speedText(nexus.eval_avg_ms)}`
    : '社区节点持续探测中 · 保持健康'
  ctx.fillStyle = B.textSec
  ctx.font = font(10)
  ctx.fillText(ellipsize(ctx, nDetail, colLeftW - 24), colLeftX + 12, nexusY + 44)

  // 4.3 左栏底部备注或属性
  const note = String(deal.note || '').trim()
  const noteY = nexusY + 68
  ctx.fillStyle = '#FFF1F2'
  roundRect(ctx, colLeftX, noteY, colLeftW, 46, 8)
  ctx.fill()
  ctx.fillStyle = B.red
  ctx.font = font(9.5, 700)
  ctx.fillText('💡 重点提示', colLeftX + 10, noteY + 18)
  ctx.fillStyle = B.textSec
  ctx.font = font(10)
  const noteContent = note || `${regionLabel(deal.region)} · 无需复杂配置 · 社区实时校验`
  ctx.fillText(ellipsize(ctx, noteContent, colLeftW - 20), colLeftX + 10, noteY + 34)

  // 4.4 右栏：社区风向标立柱卡（Vertical Social Proof Pillar）
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, colRightX, splitY, colRightW, splitH, 12)
  ctx.fill()
  ctx.strokeStyle = B.goldBorder
  ctx.lineWidth = 1.2
  roundRect(ctx, colRightX + 0.5, splitY + 0.5, colRightW - 1, splitH - 1, 12)
  ctx.stroke()

  // 立柱卡顶部小标签
  ctx.fillStyle = B.red
  roundRect(ctx, colRightX + 12, splitY + 10, colRightW - 24, 22, 6)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.font = font(10, 700)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('社区风向标', colRightX + colRightW / 2, splitY + 21)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // 数据项 1：还能用
  const cell1Y = splitY + 40
  ctx.fillStyle = B.green
  ctx.font = font(22, 900)
  ctx.textAlign = 'center'
  ctx.fillText(String(deal.vote_up || 0), colRightX + colRightW / 2, cell1Y + 30)
  ctx.fillStyle = B.textSec
  ctx.font = font(9.5, 600)
  ctx.fillText('👍 亲测能用', colRightX + colRightW / 2, cell1Y + 45)

  // 细细分隔线
  ctx.strokeStyle = '#F5EEDD'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(colRightX + 16, cell1Y + 56)
  ctx.lineTo(colRightX + colRightW - 16, cell1Y + 56)
  ctx.stroke()

  // 数据项 2：失效
  const cell2Y = cell1Y + 58
  ctx.fillStyle = B.red
  ctx.font = font(17, 800)
  ctx.fillText(String(deal.vote_down || 0), colRightX + colRightW / 2, cell2Y + 22)
  ctx.fillStyle = B.textTer
  ctx.font = font(9.5)
  ctx.fillText('👎 翻车失效', colRightX + colRightW / 2, cell2Y + 36)

  ctx.beginPath()
  ctx.moveTo(colRightX + 16, cell2Y + 46)
  ctx.lineTo(colRightX + colRightW - 16, cell2Y + 46)
  ctx.stroke()

  // 数据项 3：评分
  const cell3Y = cell2Y + 48
  const ratingCount = deal.rating_count || 0
  const average = ratingCount > 0 ? Number(((deal.rating_sum || 0) / ratingCount).toFixed(1)) : null
  ctx.fillStyle = B.goldText
  ctx.font = font(16, 800)
  ctx.fillText(average === null ? '—' : `★ ${average}`, colRightX + colRightW / 2, cell3Y + 22)
  ctx.fillStyle = B.textTer
  ctx.font = font(9)
  ctx.fillText(ratingCount > 0 ? `${ratingCount}人评测` : '暂无打分', colRightX + colRightW / 2, cell3Y + 36)
  ctx.textAlign = 'left'

  // ── 5.【核心创新】页脚：左右对调落地转化区（494 ~ 585px） ──
  // 打破右下角二维码定式：左侧白卡二维码 + 右侧强力 CTA 号召
  ctx.strokeStyle = B.goldBorder
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, 482)
  ctx.lineTo(right, 482)
  ctx.stroke()

  const qrSize = 78
  const qrX = PAD
  const qrY = 494

  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, qrX, qrY, qrSize, qrSize, 10)
  ctx.fill()
  ctx.strokeStyle = B.redBorder
  ctx.lineWidth = 1.2
  roundRect(ctx, qrX + 0.5, qrY + 0.5, qrSize - 1, qrSize - 1, 10)
  ctx.stroke()
  if (qrImg) ctx.drawImage(qrImg, qrX + 5, qrY + 5, qrSize - 10, qrSize - 10)

  // 右侧 CTA 与品牌
  const ctaX = qrX + qrSize + 16
  const ctaW = right - ctaX
  const ctaY = qrY + 4

  // 大红行动按钮
  ctx.fillStyle = B.red
  roundRect(ctx, ctaX, ctaY, ctaW, 30, 8)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.font = font(12.5, 700)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('👉 扫码立即开薅 ›', ctaX + ctaW / 2, ctaY + 15)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // 品牌与站点
  ctx.fillStyle = B.text
  ctx.font = font(12, 700)
  ctx.fillText('FavsHub 白嫖社区', ctaX, qrY + 52)

  ctx.fillStyle = B.textSec
  ctx.font = font(10)
  ctx.fillText(ellipsize(ctx, siteHost, ctaW), ctaX, qrY + 68)
}

/** 主绘制流程 · 风格 E（卡券票根 —— 真实登机牌 / VIP 门票网格版式） */
function drawVoucher(
  ctx: ShareCtx,
  deal: ShareDeal,
  qrImg: ShareImage | null,
  iconImg: ShareImage | null,
  siteHost: string,
): void {
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 背景：深邃暗夜黑蓝渐变 ──
  const bg = ctx.createLinearGradient(0, 0, LOGIC_W, LOGIC_H)
  bg.addColorStop(0, V.bgFrom)
  bg.addColorStop(1, V.bgTo)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)

  // ── 票券主体（带左右打孔内凹缺口） ──
  const tx = 18
  const tw = LOGIC_W - tx * 2 // 414
  const ty = 16
  const th = LOGIC_H - ty * 2 // 568
  const tr = 14
  const notchY = ty + 382 // 主券 382px，存根券 186px
  const notchR = 10

  // 票券阴影与背景
  ctx.fillStyle = V.ticketBg
  pathNotchedCard(ctx, tx, ty, tw, th, tr, notchY, notchR)
  ctx.fill()

  // 票券主边框
  ctx.strokeStyle = V.ticketBorder
  ctx.lineWidth = 1.2
  pathNotchedCard(ctx, tx + 0.5, ty + 0.5, tw - 1, th - 1, tr, notchY, notchR)
  ctx.stroke()

  // 左右缺口之间的虚线撕裂切痕
  ctx.save()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = V.borderDashed
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(tx + notchR + 4, notchY)
  ctx.lineTo(tx + tw - notchR - 4, notchY)
  ctx.stroke()
  ctx.restore()

  const right = tx + tw - 18
  const left = tx + 18

  // ── 1.【核心创新】登机牌顶部功能栏 + 右上角条形码（Header Barcode） ──
  const headY = ty + 24
  ctx.fillStyle = V.greenText
  ctx.font = monoFont(9.5, 700)
  ctx.fillText('BOARDING PASS // TOKEN DEALS', left, headY)

  // 仿真条形码置于右上角
  const barW = 112
  const barH = 15
  const barX = right - barW
  drawBarcode(ctx, barX, ty + 13, barW, barH, V.barcode)
  ctx.fillStyle = V.textTer
  ctx.font = monoFont(8)
  const ticketNo = `№ FV-${String(deal.id || 'DEAL').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase()}`
  ctx.fillText(ticketNo, barX, ty + 38)

  // ── 2. 服务商行：深色圆角图标 + 名称 + 100% FREE 角标 ──
  const provY = ty + 46
  const ICON = 36
  ctx.fillStyle = V.ticketInner
  roundRect(ctx, left, provY, ICON, ICON, 9)
  ctx.fill()
  ctx.strokeStyle = V.ticketBorder
  ctx.lineWidth = 1
  roundRect(ctx, left + 0.5, provY + 0.5, ICON - 1, ICON - 1, 9)
  ctx.stroke()

  if (iconImg) {
    ctx.save()
    roundRect(ctx, left + 3, provY + 3, ICON - 6, ICON - 6, 6)
    ctx.clip()
    ctx.drawImage(iconImg, left + 3, provY + 3, ICON - 6, ICON - 6)
    ctx.restore()
  } else {
    ctx.fillStyle = V.greenText
    ctx.font = monoFont(15, 700)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initialOf(deal.provider), left + ICON / 2, provY + ICON / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  const nameX = left + ICON + 10
  ctx.fillStyle = V.text
  ctx.font = font(16, 700)
  ctx.fillText(ellipsize(ctx, deal.provider || '未命名服务商', 160), nameX, provY + 16)
  ctx.fillStyle = V.textTer
  ctx.font = monoFont(9.5)
  ctx.fillText(sourceLabel(deal.source_tag), nameX, provY + 31)

  // 100% FREE 翡翠绿发光胶囊
  const freeBadge = '100% FREE'
  ctx.font = monoFont(10.5, 700)
  const fbw = ctx.measureText(freeBadge).width + 16
  const fbh = 22
  const fbx = right - fbw
  const fby = provY + 7
  ctx.fillStyle = V.green
  roundRect(ctx, fbx, fby, fbw, fbh, 5)
  ctx.fill()
  ctx.fillStyle = '#064E3B'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(freeBadge, fbx + fbw / 2, fby + fbh / 2 + 0.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // ── 3. 标题行 ──
  const titleY = provY + ICON + 12
  ctx.font = font(18, 700)
  const titleLines = wrapText(ctx, deal.title || '', right - left, 2)
  const lineH = 24
  ctx.fillStyle = '#FFFFFF'
  titleLines.forEach((line, i) => {
    ctx.fillText(line, left, titleY + 16 + i * lineH)
  })
  const barY = titleY + titleLines.length * lineH + 6
  ctx.fillStyle = V.green
  roundRect(ctx, left, barY, 36, 3, 1.5)
  ctx.fill()

  // ── 4.【核心创新】登机牌 3 舱规格看板（Flight Spec Dashboard） ──
  // 并排三格规格舱：面额 / 有效期 / 链路通道
  const dashY = barY + 10
  const dashH = 56
  const dashGap = 8
  const dashCellW = (right - left - dashGap * 2) / 3

  const quotaText = String(deal.quota || '').trim() || '未说明'
  const expiry = expiryText(deal.expires_at)
  const expiryWarn = isExpiringSoon(deal.expires_at)

  // 舱 1：面额 (VALUE)
  const c1X = left
  ctx.fillStyle = V.ticketInner
  roundRect(ctx, c1X, dashY, dashCellW, dashH, 8)
  ctx.fill()
  ctx.strokeStyle = V.ticketBorderSoft
  ctx.lineWidth = 1
  roundRect(ctx, c1X + 0.5, dashY + 0.5, dashCellW - 1, dashH - 1, 8)
  ctx.stroke()
  ctx.fillStyle = V.textTer
  ctx.font = monoFont(9, 600)
  ctx.fillText('VALUE / 面额', c1X + 8, dashY + 16)
  let qvSize = 17
  ctx.font = monoFont(qvSize, 700)
  while (qvSize > 11 && ctx.measureText(quotaText).width > dashCellW - 16) {
    qvSize -= 1
    ctx.font = monoFont(qvSize, 700)
  }
  ctx.fillStyle = V.greenText
  ctx.fillText(ellipsize(ctx, quotaText, dashCellW - 16), c1X + 8, dashY + 40)

  // 舱 2：有效期 (EXPIRATION)
  const c2X = c1X + dashCellW + dashGap
  ctx.fillStyle = V.ticketInner
  roundRect(ctx, c2X, dashY, dashCellW, dashH, 8)
  ctx.fill()
  ctx.strokeStyle = V.ticketBorderSoft
  ctx.lineWidth = 1
  roundRect(ctx, c2X + 0.5, dashY + 0.5, dashCellW - 1, dashH - 1, 8)
  ctx.stroke()
  ctx.fillStyle = V.textTer
  ctx.font = monoFont(9, 600)
  ctx.fillText('EXP / 有效期', c2X + 8, dashY + 16)
  ctx.fillStyle = expiryWarn ? V.amber : V.text
  ctx.font = monoFont(12, 700)
  ctx.fillText(ellipsize(ctx, expiry, dashCellW - 16), c2X + 8, dashY + 39)

  // 舱 3：链路 (GATE)
  const c3X = c2X + dashCellW + dashGap
  ctx.fillStyle = V.ticketInner
  roundRect(ctx, c3X, dashY, dashCellW, dashH, 8)
  ctx.fill()
  ctx.strokeStyle = V.ticketBorderSoft
  ctx.lineWidth = 1
  roundRect(ctx, c3X + 0.5, dashY + 0.5, dashCellW - 1, dashH - 1, 8)
  ctx.stroke()
  ctx.fillStyle = V.textTer
  ctx.font = monoFont(9, 600)
  ctx.fillText('GATE / 通道', c3X + 8, dashY + 16)
  ctx.fillStyle = '#38BDF8'
  ctx.font = monoFont(12, 700)
  ctx.fillText(regionLabel(deal.region), c3X + 8, dashY + 39)

  // ── 5. 模型矩阵与 Nexus 状态（dashY + dashH + 12 ~ notchY - 10） ──
  const modY = dashY + dashH + 12
  ctx.fillStyle = V.textTer
  ctx.font = monoFont(9.5, 600)
  ctx.fillText('MODELS / 支持模型', left, modY + 9)

  const models = (deal.models || []).map((m) => String(m)).filter(Boolean)
  const items = models.length <= 4 ? models : [...models.slice(0, 3), `+${models.length - 3}`]
  let mX = left
  let mY = modY + 16
  const chipH = 22
  ctx.font = monoFont(10)
  items.forEach((m, i) => {
    const w = ctx.measureText(m).width + 16
    if (mX + w > right) {
      mX = left
      mY += chipH + 5
    }
    if (mY + chipH > notchY - 32) return
    const first = i === 0
    ctx.fillStyle = first ? V.greenSoft : V.ticketInner
    roundRect(ctx, mX, mY, w, chipH, 5)
    ctx.fill()
    ctx.strokeStyle = first ? V.greenBorder : V.ticketBorder
    ctx.lineWidth = 1
    roundRect(ctx, mX + 0.5, mY + 0.5, w - 1, chipH - 1, 5)
    ctx.stroke()
    ctx.fillStyle = first ? V.greenText : V.textSec
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(m, mX + w / 2, mY + chipH / 2 + 0.5)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    mX += w + 6
  })

  // Nexus 实测读数
  const nexus = deal.nexus
  if (nexus) {
    const text = !nexus.enabled
      ? '> NEXUS: DISABLED'
      : nexus.eval_total > 0
        ? `> NEXUS OK: ${nexus.eval_ok}/${nexus.eval_total} · AVG: ${speedText(nexus.eval_avg_ms)}`
        : '> NEXUS: PROBING'
    ctx.fillStyle = nexus.enabled ? V.greenText : V.textTer
    ctx.font = monoFont(9.5)
    ctx.fillText(ellipsize(ctx, text, right - left), left, notchY - 12)
  }

  // ── 6.【核心创新】副券/存根区（Claim Stub，虚线下方） ──
  // 独立兑换券布局：左侧凭证验证与操作引导 + 右侧大号核销二维码
  const stubY = notchY + 16
  const qrSize = 78
  const qrX = right - qrSize

  // 右侧白卡核销二维码
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, qrX, stubY, qrSize, qrSize, 8)
  ctx.fill()
  ctx.strokeStyle = V.green
  ctx.lineWidth = 1.2
  roundRect(ctx, qrX + 0.5, stubY + 0.5, qrSize - 1, qrSize - 1, 8)
  ctx.stroke()
  if (qrImg) ctx.drawImage(qrImg, qrX + 5, stubY + 5, qrSize - 10, qrSize - 10)

  // 左侧存根凭据
  const stubLeftW = qrX - left - 14
  ctx.fillStyle = V.greenText
  ctx.font = monoFont(11.5, 700)
  ctx.fillText('CLAIM STUB // 兑换存根', left, stubY + 14)

  // 社区验证与状态
  const ratingCount = deal.rating_count || 0
  const average = ratingCount > 0 ? Number(((deal.rating_sum || 0) / ratingCount).toFixed(1)) : null
  ctx.fillStyle = V.textSec
  ctx.font = monoFont(10)
  ctx.fillText(`● ${deal.vote_up || 0} VERIFIED · ${deal.vote_down || 0} EXPIRED`, left, stubY + 34)

  ctx.fillStyle = V.amber
  ctx.font = monoFont(10, 700)
  ctx.fillText(average === null ? '★ NO REVIEWS' : `★ ${average} SCORE (${ratingCount} VOTES)`, left, stubY + 51)

  // 引导文案
  ctx.fillStyle = '#38BDF8'
  ctx.font = monoFont(10.5, 700)
  ctx.fillText('SCAN TO CLAIM · 凭券扫码核销', left, stubY + 70)

  ctx.fillStyle = V.textTer
  ctx.font = monoFont(9)
  ctx.fillText(ellipsize(ctx, `FavsHub · ${siteHost}`, stubLeftW), left, stubY + 84)
}

/** 五风格绘制函数表 */
const DRAWERS: Record<ShareCardStyle, (
  ctx: ShareCtx,
  deal: ShareDeal,
  qrImg: ShareImage | null,
  iconImg: ShareImage | null,
  siteHost: string,
) => void> = {
  magazine: drawMagazine,
  neon: drawNeon,
  clay: drawClay,
  blast: drawBlast,
  voucher: drawVoucher,
}

/**
 * 统一绘制入口 —— 前后端共用。
 *
 * 调用方负责：
 *   1. 创建画布并把 `ctx` 传进来（浏览器 `document.createElement('canvas')`，
 *      服务端 `@napi-rs/canvas` 的 `createCanvas`）；
 *   2. 自行 `ctx.scale(2, 2)`（本函数按逻辑尺寸 450×600 绘制）；
 *   3. 预加载 `qrImg` / `iconImg` 位图（加载失败传 null，绘制层走占位）。
 *
 * @param siteHost 卡片底部展示的域名（不含协议）
 */
export function drawShareCard(
  ctx: ShareCtx,
  deal: ShareDeal,
  options: {
    qrImg?: ShareImage | null
    iconImg?: ShareImage | null
    siteHost?: string
    style?: ShareCardStyle
  } = {},
): void {
  const draw = DRAWERS[options.style || 'magazine'] || drawMagazine
  draw(ctx, deal, options.qrImg ?? null, options.iconImg ?? null, options.siteHost || 'FavsHub')
}

/** 卡片逻辑尺寸（调用方按此 ×2 建画布） */
export const SHARE_LOGIC_W = LOGIC_W
export const SHARE_LOGIC_H = LOGIC_H
