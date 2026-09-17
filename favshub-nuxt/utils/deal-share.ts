/**
 * Token 通告分享卡片 — 前端 Canvas 2D 绘制
 *
 * 版式固定 3:4（900 × 1200 @2x），**不随站点主题切换**。
 *
 * 绘制坐标按逻辑尺寸 450 × 600 计算，通过 ctx.scale(2) 输出 2 倍图。
 * 本模块只依赖浏览器 Canvas / Image，不依赖 DOM 结构与站点 CSS 变量。
 *
 * 双风格并存，BuildShareOptions.style 切换（默认 magazine）：
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

/** 卡片风格标识 */
export type ShareCardStyle = 'magazine' | 'neon' | 'clay'

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

export interface BuildShareOptions {
  /** 二维码位图 dataURL（由 makeQrDataUrl 生成） */
  qrDataUrl?: string | null
  /** 渠道 favicon 地址；同源 /api/favicon 代理，加载失败回退首字母 */
  iconUrl?: string | null
  /** 卡片底部展示的站点域名（如 hao.bx9y.com.cn） */
  siteHost?: string
  /** 卡片风格：magazine 编辑杂志（默认）/ neon 深色终端 */
  style?: ShareCardStyle
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
function radialGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
}

/** 圆角矩形路径（不直接填充，便于 fill / stroke / clip 复用） */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
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
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
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
function drawCoin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, lw = 1.6): void {
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
function drawCalendar(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
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
function drawPulse(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string): void {
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
function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
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

/**
 * 加载图片（favicon / 二维码），失败或超时一律返回 null，由调用方走占位。
 * 同源（/api/favicon 代理）不设 crossOrigin，避免无谓的 CORS 预检。
 */
function loadImage(src: string, timeoutMs = 4000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return }
    let settled = false
    const finish = (img: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      resolve(img)
    }
    const img = new Image()
    try {
      const base = typeof location !== 'undefined' ? location.href : 'https://localhost/'
      const u = new URL(src, base)
      if (typeof location !== 'undefined' && u.origin !== location.origin) img.crossOrigin = 'anonymous'
    } catch { /* 相对路径按同源处理 */ }
    img.onload = () => finish(img)
    img.onerror = () => finish(null)
    setTimeout(() => finish(null), timeoutMs)
    img.src = src
  })
}

/** 主绘制流程 · 风格 A（编辑杂志 × 票根） */
function drawMagazine(
  ctx: CanvasRenderingContext2D,
  deal: ShareDeal,
  qrImg: HTMLImageElement | null,
  iconImg: HTMLImageElement | null,
  siteHost: string,
): void {
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 纸面底色 + 左下角极淡同心圆纹理 + 右上角代币水印（出血式） ──
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)
  ctx.strokeStyle = 'rgba(109,40,217,0.05)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(-50, LOGIC_H + 30, 180, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(-50, LOGIC_H + 30, 148, 0, Math.PI * 2)
  ctx.stroke()
  drawCoin(ctx, LOGIC_W - 4, 48 + 52, 44, 'rgba(109,40,217,0.08)', 2.5)

  // ── 1. 刊头：深墨通栏 + 紫色刊头线 ──
  const MAST = 48
  ctx.fillStyle = C.mast
  ctx.fillRect(0, 0, LOGIC_W, MAST)
  ctx.fillStyle = C.accent
  ctx.fillRect(0, MAST, LOGIC_W, 2)

  // 刊头左：紫色小方块 + 字距品牌标 + 栏目标
  ctx.fillStyle = C.accent
  roundRect(ctx, PAD, (MAST - 9) / 2, 9, 9, 2)
  ctx.fill()
  let mx = PAD + 17
  ctx.fillStyle = C.mastText
  ctx.font = font(11, 600)
  ctx.fillText('F A V S H U B', mx, MAST / 2 + 4)
  mx += ctx.measureText('F A V S H U B').width + 11
  ctx.fillStyle = C.mastDim
  ctx.beginPath()
  ctx.arc(mx, MAST / 2 - 1, 1.5, 0, Math.PI * 2)
  ctx.fill()
  mx += 12
  ctx.font = font(10)
  ctx.fillText('TOKEN 白嫖通告', mx, MAST / 2 + 3.5)

  // 刊头右：明黄品质章（平直不旋转）
  const qText = String(deal.quality || '中品')
  ctx.font = font(11, 600)
  const qw = ctx.measureText(qText).width + 18
  const qh = 22
  const qx = right - qw
  ctx.fillStyle = C.yellow
  roundRect(ctx, qx, (MAST - qh) / 2, qw, qh, 6)
  ctx.fill()
  ctx.fillStyle = C.yellowText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(qText, qx + qw / 2, MAST / 2 + 0.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (deal.pinned) drawPin(ctx, qx - 15, (MAST - qh) / 2 + 3, C.mastText)

  // ── 2. 服务商行：白砖 favicon + 名称 + 区域·来源 ──
  const provY = MAST + 22
  const ICON = 40
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, PAD, provY, ICON, ICON, 10)
  ctx.fill()
  ctx.strokeStyle = C.rule
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, provY + 0.5, ICON - 1, ICON - 1, 10)
  ctx.stroke()
  if (iconImg) {
    ctx.save()
    roundRect(ctx, PAD + 4, provY + 4, ICON - 8, ICON - 8, 7)
    ctx.clip()
    ctx.drawImage(iconImg, PAD + 4, provY + 4, ICON - 8, ICON - 8)
    ctx.restore()
  } else {
    ctx.fillStyle = C.accent
    ctx.font = font(16, 600)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initialOf(deal.provider), PAD + ICON / 2, provY + ICON / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
  const nameX = PAD + ICON + 12
  const nameMax = right - nameX
  ctx.fillStyle = C.ink
  ctx.font = font(16, 600)
  ctx.fillText(ellipsize(ctx, deal.provider || '未命名服务商', nameMax), nameX, provY + 18)
  ctx.fillStyle = C.inkSec
  ctx.font = font(10.5)
  ctx.fillText(
    ellipsize(ctx, `${regionLabel(deal.region)} · ${sourceLabel(deal.source_tag)}`, nameMax),
    nameX,
    provY + 34,
  )

  // ── 3. 标题：21px 浓墨粗体 ≤2 行 + 紫色短杠 ──
  const titleTop = provY + ICON + 16
  ctx.font = font(21, 700)
  const titleLines = wrapText(ctx, deal.title || '', right - PAD, 2)
  const lineH = 28
  ctx.fillStyle = C.ink
  titleLines.forEach((line, i) => {
    ctx.fillText(line, PAD, titleTop + 19 + i * lineH)
  })
  const barY = titleTop + titleLines.length * lineH + 8
  ctx.fillStyle = C.accent
  roundRect(ctx, PAD, barY, 44, 4, 2)
  ctx.fill()
  const headerBottom = barY + 4

  // ── 4. 内容块（统计 → 票根虚线 → 模型 → Nexus → 健康度 → 备注），统一节奏 ──
  const footerQR = 72
  const qrY = LOGIC_H - 24 - footerQR
  const contentTop = headerBottom + 18
  const contentBottom = qrY - 14
  const ratingCount = deal.rating_count || 0
  const average = ratingCount > 0 ? Number(((deal.rating_sum || 0) / ratingCount).toFixed(1)) : null
  const blocks: Block[] = []

  // 4.1 大数字统计：短额度走「展示级大数字 + 有效期」双栏；
  // 长额度（线上 44% 超 20 字）切整宽多行，有效期降为标签行右侧紧凑读数
  const quotaText = String(deal.quota || '').trim() || '未说明'
  const expiry = expiryText(deal.expires_at)
  const expiryWarn = isExpiringSoon(deal.expires_at)
  const quotaLong = isLongQuota(quotaText)
  ctx.font = font(12.5, 500)
  const quotaLines = quotaLong ? wrapText(ctx, quotaText, right - PAD, QUOTA_WRAP_LINES) : []
  blocks.push({
    height: quotaLong ? 34 + (quotaLines.length - 1) * 17 : 42,
    gap: 0,
    draw: (top) => {
      if (!quotaLong) {
        const colW2 = (right - PAD) / 2
        const x2 = PAD + colW2 + 12
        ctx.strokeStyle = C.rule
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(PAD + colW2 - 5.5, top + 6)
        ctx.lineTo(PAD + colW2 - 5.5, top + 36)
        ctx.stroke()
        ctx.fillStyle = C.inkTer
        ctx.font = font(10)
        drawCoin(ctx, PAD + 5, top + 8, 4, C.accent, 1.4)
        ctx.fillText('免费额度', PAD + 14, top + 12)
        drawCalendar(ctx, x2 + 1, top + 3.5, 9, expiryWarn ? C.amber : C.inkTer)
        ctx.fillText('有效期', x2 + 15, top + 12)
        // 额度大数字自适应字号：24 → 14 逐级降，装得下就不截断
        let qSize = 24
        ctx.font = font(qSize, 700)
        while (qSize > 14 && ctx.measureText(quotaText).width > colW2 - 24) {
          qSize -= 2
          ctx.font = font(qSize, 700)
        }
        ctx.fillStyle = C.ink
        ctx.fillText(ellipsize(ctx, quotaText, colW2 - 24), PAD, top + 38)
        ctx.fillStyle = expiryWarn ? C.amber : C.ink
        ctx.font = font(16, 700)
        ctx.fillText(ellipsize(ctx, expiry, right - x2), x2, top + 36)
        return
      }
      // 长额度：标签行（左「免费额度」/ 右「有效期 读数」）+ 整宽多行正文
      ctx.fillStyle = C.inkTer
      ctx.font = font(10)
      drawCoin(ctx, PAD + 5, top + 8, 4, C.accent, 1.4)
      ctx.fillText('免费额度', PAD + 14, top + 12)
      ctx.textAlign = 'right'
      ctx.fillStyle = expiryWarn ? C.amber : C.inkSec
      ctx.font = font(11, expiryWarn ? 600 : 500)
      ctx.fillText(expiry, right, top + 12)
      const ew = ctx.measureText(expiry).width
      ctx.fillStyle = C.inkTer
      ctx.font = font(10)
      ctx.fillText('有效期', right - ew - 6, top + 12)
      ctx.textAlign = 'left'
      drawCalendar(ctx, right - ew - 22, top + 3.5, 9, expiryWarn ? C.amber : C.inkTer)
      ctx.fillStyle = C.ink
      ctx.font = font(12.5, 500)
      quotaLines.forEach((line, i) => {
        ctx.fillText(line, PAD, top + 28 + i * 17)
      })
    },
  })

  // 4.2 票根虚线分隔
  blocks.push({
    height: 10,
    gap: 0,
    draw: (top) => {
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = C.ruleDark
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD, top + 5.5)
      ctx.lineTo(right, top + 5.5)
      ctx.stroke()
      ctx.restore()
    },
  })

  // 4.3 模型标签（描边药丸，首枚紫色高亮）
  const models = (deal.models || []).map((m) => String(m)).filter(Boolean)
  if (models.length) {
    const chipH = 22
    const items = models.length <= 4 ? models : [...models.slice(0, 3), `+${models.length - 3}`]
    blocks.push({
      height: chipH,
      gap: 0,
      draw: (top) => {
        ctx.font = font(11)
        let cx = PAD
        items.forEach((m, i) => {
          const w = ctx.measureText(m).width + 20
          if (cx + w > right) return
          const first = i === 0
          ctx.fillStyle = first ? C.accentSoft : '#FFFFFF'
          roundRect(ctx, cx, top, w, chipH, 11)
          ctx.fill()
          ctx.strokeStyle = first ? C.accent : C.ruleDark
          ctx.lineWidth = 1
          roundRect(ctx, cx + 0.5, top + 0.5, w - 1, chipH - 1, 11)
          ctx.stroke()
          ctx.fillStyle = first ? C.accent : C.inkSec
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(m, cx + w / 2, top + chipH / 2 + 0.5)
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
          cx += w + 6
        })
      },
    })
  }

  // 4.4 Nexus 实测：单行文字 + 状态点（不做色块）
  const nexus = deal.nexus
  if (nexus) {
    const text = !nexus.enabled
      ? 'Nexus 已禁用'
      : nexus.eval_total > 0
        ? `Nexus 实测 ${nexus.eval_ok}/${nexus.eval_total}${nexus.eval_avg_ms > 0 ? ` · 均 ${speedText(nexus.eval_avg_ms)}` : ''}`
        : 'Nexus 已接入 · 暂无探测数据'
    blocks.push({
      height: 18,
      gap: 0,
      draw: (top) => {
        drawPulse(ctx, PAD, top + 9.5, 12, nexus.enabled ? C.accent : C.inkTer)
        ctx.fillStyle = nexus.enabled ? C.inkSec : C.inkTer
        ctx.font = font(11.5)
        ctx.fillText(ellipsize(ctx, text, right - PAD - 22), PAD + 19, top + 13.5)
      },
    })
  }

  // 4.5 社区健康度：三栏细竖线分隔（无色块，编辑式数据栏）
  const healthCells = [
    { num: String(deal.vote_up || 0), label: '还能用', fg: C.ok },
    { num: String(deal.vote_down || 0), label: '已失效', fg: C.danger },
    {
      num: average === null ? '—' : `★ ${average}`,
      label: ratingCount > 0 ? `${ratingCount} 人评测` : '暂无评测',
      fg: C.amber,
    },
  ]
  blocks.push({
    height: 44,
    gap: 0,
    draw: (top) => {
      const cw = (right - PAD) / 3
      healthCells.forEach((c, i) => {
        if (i > 0) {
          ctx.strokeStyle = C.rule
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(PAD + i * cw + 0.5, top + 4)
          ctx.lineTo(PAD + i * cw + 0.5, top + 38)
          ctx.stroke()
        }
        const cx = PAD + i * cw + cw / 2
        ctx.textAlign = 'center'
        ctx.fillStyle = c.fg
        ctx.font = font(20, 700)
        ctx.fillText(c.num, cx, top + 23)
        ctx.fillStyle = C.inkTer
        ctx.font = font(9.5)
        ctx.fillText(c.label, cx, top + 38)
        ctx.textAlign = 'left'
      })
    },
  })

  // 4.6 备注（单行，完整内容由二维码指向的详情页承载）
  const note = String(deal.note || '').replace(/\s+/g, ' ').trim()
  if (note) {
    blocks.push({
      height: 18,
      gap: 0,
      draw: (top) => {
        const baseline = top + 13
        ctx.fillStyle = C.inkTer
        ctx.font = font(10.5)
        ctx.fillText('备注', PAD, baseline)
        ctx.fillStyle = C.inkSec
        ctx.font = font(11.5)
        ctx.fillText(ellipsize(ctx, note, right - PAD - 62), PAD + 62, baseline)
      },
    })
  }

  // 4.7 稀疏兜底：字段少（≤3 块）时补虚线提示卡，把留白变成引导
  if (blocks.length <= 3) {
    blocks.push({
      height: 34,
      gap: 0,
      draw: (top) => {
        ctx.save()
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = C.ruleDark
        ctx.lineWidth = 1
        roundRect(ctx, PAD + 0.5, top + 0.5, right - PAD - 1, 33, 10)
        ctx.stroke()
        ctx.restore()
        ctx.fillStyle = C.inkTer
        ctx.font = font(11)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('更多权益与接入方式 · 扫码查看详情', (PAD + right) / 2, top + 17.5)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
      },
    })
  }

  // 统一节奏：所有块间距同一值（基础 12 + 均摊，上限 26），剩余空白上下均分
  const GAP_BASE = 12
  const GAP_MAX = 26
  const sumHeights = blocks.reduce((sum, b) => sum + b.height, 0)
  const avail = contentBottom - contentTop
  const gapEach = blocks.length > 1
    ? Math.min(GAP_MAX, GAP_BASE + Math.max(0, (avail - sumHeights - GAP_BASE * (blocks.length - 1)) / (blocks.length - 1)))
    : 0
  const consumed = sumHeights + gapEach * Math.max(0, blocks.length - 1)
  // 居中但略偏上（0.45）：视觉重心高于几何中心更接近阅读习惯
  let by = contentTop + Math.max(0, avail - consumed) * 0.45
  for (const block of blocks) {
    block.draw(by)
    by += block.height + gapEach
  }

  // ── 5. 页脚：实线分隔 + 左品牌域名 + 右白卡二维码 ──
  ctx.strokeStyle = C.rule
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, qrY - 11.5)
  ctx.lineTo(right, qrY - 11.5)
  ctx.stroke()

  const qrX = right - footerQR
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, qrX, qrY, footerQR, footerQR, 10)
  ctx.fill()
  ctx.strokeStyle = C.ruleDark
  ctx.lineWidth = 1
  roundRect(ctx, qrX + 0.5, qrY + 0.5, footerQR - 1, footerQR - 1, 10)
  ctx.stroke()
  if (qrImg) ctx.drawImage(qrImg, qrX + 6, qrY + 6, footerQR - 12, footerQR - 12)

  const leftMax = qrX - PAD - 16
  ctx.fillStyle = C.ink
  ctx.font = font(12, 600)
  const brandW = ctx.measureText('FavsHub').width
  ctx.fillText('FavsHub', PAD, qrY + 26)
  ctx.fillStyle = C.inkSec
  ctx.font = font(11.5)
  ctx.fillText(ellipsize(ctx, siteHost, leftMax - brandW - 8), PAD + brandW + 8, qrY + 26)
  ctx.fillStyle = C.inkTer
  ctx.font = font(10)
  ctx.fillText(ellipsize(ctx, '扫码查看通告详情 · 社区众包数据', leftMax), PAD, qrY + 46)
}

/** 主绘制流程 · 风格 B（深色终端） */
function drawNeon(
  ctx: CanvasRenderingContext2D,
  deal: ShareDeal,
  qrImg: HTMLImageElement | null,
  iconImg: HTMLImageElement | null,
  siteHost: string,
): void {
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 背景：墨蓝对角渐变 + 青/紫径向辉光 + 点阵网格 ──
  const bg = ctx.createLinearGradient(0, 0, LOGIC_W, LOGIC_H)
  bg.addColorStop(0, N.bgFrom)
  bg.addColorStop(1, N.bgTo)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)
  radialGlow(ctx, 392, 56, 190, 'rgba(34,211,238,0.10)')
  radialGlow(ctx, 36, 560, 210, 'rgba(167,139,250,0.10)')
  ctx.fillStyle = 'rgba(148,163,216,0.055)'
  for (let gy = 14; gy < LOGIC_H; gy += 26) {
    for (let gx = 14; gx < LOGIC_W; gx += 26) {
      ctx.fillRect(gx, gy, 1.4, 1.4)
    }
  }

  // ── 1. 终端窗口栏：三圆点 + 路径标题 + [品质] 标签 ──
  const BAR = 34
  ctx.fillStyle = N.barBg
  ctx.fillRect(0, 0, LOGIC_W, BAR)
  ctx.strokeStyle = N.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, BAR + 0.5)
  ctx.lineTo(LOGIC_W, BAR + 0.5)
  ctx.stroke()
  const dotColors = ['#FF5F57', '#FEBC2E', '#28C840']
  dotColors.forEach((color, i) => {
    ctx.globalAlpha = 0.85
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(PAD + 4 + i * 13, BAR / 2, 3.6, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.globalAlpha = 1
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(10.5)
  ctx.fillText('favshub ~/token-deals', PAD + 46, BAR / 2 + 3.5)

  // [品质] 琥珀标签（终端 tag 风，平直描边）
  const qText = String(deal.quality || '中品')
  ctx.font = monoFont(11, 600)
  const qLabel = `[${qText}]`
  const qw = ctx.measureText(qLabel).width + 14
  const qh = 20
  const qx = right - qw
  ctx.strokeStyle = 'rgba(251,191,36,0.55)'
  ctx.lineWidth = 1
  roundRect(ctx, qx + 0.5, (BAR - qh) / 2 + 0.5, qw - 1, qh - 1, 5)
  ctx.stroke()
  ctx.fillStyle = N.amber
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(qLabel, qx + qw / 2, BAR / 2 + 0.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (deal.pinned) drawPin(ctx, qx - 15, (BAR - qh) / 2 + 2, N.textSec)

  // ── 2. 服务商行：描边 favicon 砖 + 名称 + 等宽小字血统 ──
  const provY = BAR + 18
  const ICON = 40
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  roundRect(ctx, PAD, provY, ICON, ICON, 10)
  ctx.fill()
  ctx.strokeStyle = N.lineStrong
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, provY + 0.5, ICON - 1, ICON - 1, 10)
  ctx.stroke()
  if (iconImg) {
    ctx.save()
    roundRect(ctx, PAD + 4, provY + 4, ICON - 8, ICON - 8, 7)
    ctx.clip()
    ctx.drawImage(iconImg, PAD + 4, provY + 4, ICON - 8, ICON - 8)
    ctx.restore()
  } else {
    ctx.fillStyle = N.cyan
    ctx.font = monoFont(16, 700)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initialOf(deal.provider), PAD + ICON / 2, provY + ICON / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
  const nameX = PAD + ICON + 12
  const nameMax = right - nameX
  ctx.fillStyle = N.text
  ctx.font = font(16, 600)
  ctx.fillText(ellipsize(ctx, deal.provider || '未命名服务商', nameMax), nameX, provY + 18)
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(10)
  ctx.fillText(
    ellipsize(ctx, `${regionLabel(deal.region)} · ${sourceLabel(deal.source_tag)}`, nameMax),
    nameX,
    provY + 34,
  )

  // ── 3. 标题：20px 高亮白 ≤2 行 + 青→透明渐变短杠 ──
  const titleTop = provY + ICON + 16
  ctx.font = font(20, 700)
  const titleLines = wrapText(ctx, deal.title || '', right - PAD, 2)
  const lineH = 27
  ctx.fillStyle = '#F2F5FD'
  titleLines.forEach((line, i) => {
    ctx.fillText(line, PAD, titleTop + 18 + i * lineH)
  })
  const barY = titleTop + titleLines.length * lineH + 8
  const barGrad = ctx.createLinearGradient(PAD, 0, PAD + 52, 0)
  barGrad.addColorStop(0, N.cyan)
  barGrad.addColorStop(1, 'rgba(34,211,238,0)')
  ctx.fillStyle = barGrad
  roundRect(ctx, PAD, barY, 52, 3.5, 1.75)
  ctx.fill()
  const headerBottom = barY + 3.5

  // ── 4. 内容块（统计格 → 虚线 → 模型 → Nexus 读数 → 健康度 → 备注），统一节奏 ──
  const footerQR = 72
  const qrY = LOGIC_H - 24 - footerQR
  const contentTop = headerBottom + 18
  const contentBottom = qrY - 14
  const ratingCount = deal.rating_count || 0
  const average = ratingCount > 0 ? Number(((deal.rating_sum || 0) / ratingCount).toFixed(1)) : null
  const blocks: Block[] = []

  // 4.1 统计格：短额度走 FREE QUOTA / EXPIRES 双格霓虹大数字；
  // 长额度切整宽单格多行（微标签 + 换行读数 + 右侧 EXPIRES）
  const quotaText = String(deal.quota || '').trim() || '未说明'
  const expiry = expiryText(deal.expires_at)
  const expiryWarn = isExpiringSoon(deal.expires_at)
  const quotaLong = isLongQuota(quotaText)
  ctx.font = monoFont(11.5)
  const quotaLines = quotaLong ? wrapText(ctx, quotaText, right - PAD - 22, QUOTA_WRAP_LINES) : []
  blocks.push({
    height: quotaLong ? 38 + (quotaLines.length - 1) * 15 : 50,
    gap: 0,
    draw: (top) => {
      if (!quotaLong) {
        const gap = 14
        const cw = (right - PAD - gap) / 2
        const cells = [
          { label: 'FREE QUOTA', value: quotaText, warn: false, icon: 'coin' as const },
          { label: 'EXPIRES', value: expiry, warn: expiryWarn, icon: 'cal' as const },
        ]
        cells.forEach((cell, i) => {
          const cx0 = PAD + i * (cw + gap)
          ctx.fillStyle = N.cellBg
          roundRect(ctx, cx0, top, cw, 50, 10)
          ctx.fill()
          ctx.strokeStyle = cell.warn ? 'rgba(251,191,36,0.4)' : N.line
          ctx.lineWidth = 1
          roundRect(ctx, cx0 + 0.5, top + 0.5, cw - 1, 49, 10)
          ctx.stroke()
          if (cell.icon === 'coin') drawCoin(ctx, cx0 + 15, top + 12, 4, N.cyan, 1.3)
          else drawCalendar(ctx, cx0 + 10.5, top + 7.5, 9, cell.warn ? N.amber : N.textTer)
          ctx.fillStyle = N.textTer
          ctx.font = monoFont(8.5)
          ctx.fillText(cell.label, cx0 + 24, top + 15)
          const valueColor = cell.warn ? N.amber : i === 0 ? N.cyan : N.text
          // 大数字字号自适应：20 → 13 逐级降，装得下就不截断
          let vSize = i === 0 ? 20 : 15
          ctx.font = monoFont(vSize, 700)
          while (vSize > 12 && ctx.measureText(cell.value).width > cw - 22) {
            vSize -= 1
            ctx.font = monoFont(vSize, 700)
          }
          ctx.fillStyle = valueColor
          ctx.fillText(ellipsize(ctx, cell.value, cw - 22), cx0 + 11, top + 39)
        })
        return
      }
      // 长额度：整宽单格
      const bw = right - PAD
      ctx.fillStyle = N.cellBg
      roundRect(ctx, PAD, top, bw, 38 + (quotaLines.length - 1) * 15, 10)
      ctx.fill()
      ctx.strokeStyle = N.line
      ctx.lineWidth = 1
      roundRect(ctx, PAD + 0.5, top + 0.5, bw - 1, 37 + (quotaLines.length - 1) * 15, 10)
      ctx.stroke()
      drawCoin(ctx, PAD + 15, top + 10, 4, N.cyan, 1.3)
      ctx.fillStyle = N.textTer
      ctx.font = monoFont(8.5)
      ctx.fillText('FREE QUOTA', PAD + 24, top + 14)
      ctx.textAlign = 'right'
      ctx.fillStyle = expiryWarn ? N.amber : N.textSec
      ctx.font = monoFont(11, 500)
      ctx.fillText(expiry, right - 11, top + 14)
      const ew = ctx.measureText(expiry).width
      ctx.fillStyle = N.textTer
      ctx.font = monoFont(8.5)
      ctx.fillText('EXPIRES', right - 11 - ew - 6, top + 14)
      ctx.textAlign = 'left'
      ctx.fillStyle = N.text
      ctx.font = monoFont(11.5)
      quotaLines.forEach((line, i) => {
        ctx.fillText(line, PAD + 11, top + 30 + i * 15)
      })
    },
  })

  // 4.2 虚线分隔（终端分隔带）
  blocks.push({
    height: 10,
    gap: 0,
    draw: (top) => {
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = N.line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD, top + 5.5)
      ctx.lineTo(right, top + 5.5)
      ctx.stroke()
      ctx.restore()
    },
  })

  // 4.3 模型标签（等宽描边 chips，首枚青色高亮）
  const models = (deal.models || []).map((m) => String(m)).filter(Boolean)
  if (models.length) {
    const chipH = 22
    const items = models.length <= 4 ? models : [...models.slice(0, 3), `+${models.length - 3}`]
    blocks.push({
      height: chipH,
      gap: 0,
      draw: (top) => {
        ctx.font = monoFont(10.5)
        let cx = PAD
        items.forEach((m, i) => {
          const w = ctx.measureText(m).width + 18
          if (cx + w > right) return
          const first = i === 0
          if (first) {
            ctx.fillStyle = 'rgba(34,211,238,0.08)'
            roundRect(ctx, cx, top, w, chipH, 6)
            ctx.fill()
          }
          ctx.strokeStyle = first ? 'rgba(34,211,238,0.5)' : N.lineStrong
          ctx.lineWidth = 1
          roundRect(ctx, cx + 0.5, top + 0.5, w - 1, chipH - 1, 6)
          ctx.stroke()
          ctx.fillStyle = first ? N.cyan : N.textSec
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(m, cx + w / 2, top + chipH / 2 + 0.5)
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
          cx += w + 6
        })
      },
    })
  }

  // 4.4 Nexus 读数：> nexus probe · ok/total ok · avg xxxms（分段着色）
  const nexus = deal.nexus
  if (nexus) {
    blocks.push({
      height: 18,
      gap: 0,
      draw: (top) => {
        const baseline = top + 13.5
        let nx = PAD
        ctx.font = monoFont(11.5, 600)
        ctx.fillStyle = N.green
        ctx.fillText('>', nx, baseline)
        nx += 13
        ctx.font = monoFont(11.5)
        if (!nexus.enabled) {
          ctx.fillStyle = N.textTer
          ctx.fillText('nexus probe ·', nx, baseline)
          nx += ctx.measureText('nexus probe ·').width + 6
          ctx.fillStyle = N.red
          ctx.fillText('disabled', nx, baseline)
        } else if (nexus.eval_total > 0) {
          ctx.fillStyle = N.textTer
          ctx.fillText('nexus probe ·', nx, baseline)
          nx += ctx.measureText('nexus probe ·').width + 6
          ctx.fillStyle = N.green
          const okText = `${nexus.eval_ok}/${nexus.eval_total} ok`
          ctx.fillText(okText, nx, baseline)
          nx += ctx.measureText(okText).width
          if (nexus.eval_avg_ms > 0) {
            ctx.fillStyle = N.textSec
            ctx.fillText(` · avg ${speedText(nexus.eval_avg_ms)}`, nx, baseline)
          }
        } else {
          ctx.fillStyle = N.textTer
          ctx.fillText('nexus probe ·', nx, baseline)
          nx += ctx.measureText('nexus probe ·').width + 6
          ctx.fillStyle = N.amber
          ctx.fillText('connected, no data', nx, baseline)
        }
      },
    })
  }

  // 4.5 社区健康度：▲▼★ 霓虹三色三栏（细竖线分隔）
  const healthCells = [
    { glyph: '▲', num: String(deal.vote_up || 0), label: '还能用', fg: N.green },
    { glyph: '▼', num: String(deal.vote_down || 0), label: '已失效', fg: N.red },
    {
      glyph: '★',
      num: average === null ? '—' : String(average),
      label: ratingCount > 0 ? `${ratingCount} 人评测` : '暂无评测',
      fg: N.amber,
    },
  ]
  blocks.push({
    height: 44,
    gap: 0,
    draw: (top) => {
      const cw = (right - PAD) / 3
      healthCells.forEach((cell, i) => {
        if (i > 0) {
          ctx.strokeStyle = N.lineSoft
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(PAD + i * cw + 0.5, top + 4)
          ctx.lineTo(PAD + i * cw + 0.5, top + 38)
          ctx.stroke()
        }
        const cx = PAD + i * cw + cw / 2
        ctx.textAlign = 'center'
        ctx.fillStyle = cell.fg
        ctx.font = monoFont(17, 700)
        ctx.fillText(`${cell.glyph} ${cell.num}`, cx, top + 22)
        ctx.fillStyle = N.textTer
        ctx.font = font(9.5)
        ctx.fillText(cell.label, cx, top + 38)
        ctx.textAlign = 'left'
      })
    },
  })

  // 4.6 备注：// 注释风（等宽）
  const note = String(deal.note || '').replace(/\s+/g, ' ').trim()
  if (note) {
    blocks.push({
      height: 18,
      gap: 0,
      draw: (top) => {
        const baseline = top + 13
        ctx.font = monoFont(10.5)
        ctx.fillStyle = N.textTer
        ctx.fillText('//', PAD, baseline)
        const prefixW = ctx.measureText('//').width + 6
        ctx.fillStyle = N.textSec
        ctx.fillText(ellipsize(ctx, note, right - PAD - prefixW), PAD + prefixW, baseline)
      },
    })
  }

  // 4.7 稀疏兜底：字段少（≤3 块）时补虚线提示卡
  if (blocks.length <= 3) {
    blocks.push({
      height: 34,
      gap: 0,
      draw: (top) => {
        ctx.save()
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = N.line
        ctx.lineWidth = 1
        roundRect(ctx, PAD + 0.5, top + 0.5, right - PAD - 1, 33, 8)
        ctx.stroke()
        ctx.restore()
        ctx.fillStyle = N.textTer
        ctx.font = monoFont(10.5)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('// 更多权益与接入方式 → 扫码查看详情', (PAD + right) / 2, top + 17.5)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
      },
    })
  }

  // 统一节奏：所有块间距同一值（基础 12 + 均摊，上限 26），剩余空白 0.45 偏上居中
  const GAP_BASE = 12
  const GAP_MAX = 26
  const sumHeights = blocks.reduce((sum, b) => sum + b.height, 0)
  const avail = contentBottom - contentTop
  const gapEach = blocks.length > 1
    ? Math.min(GAP_MAX, GAP_BASE + Math.max(0, (avail - sumHeights - GAP_BASE * (blocks.length - 1)) / (blocks.length - 1)))
    : 0
  const consumed = sumHeights + gapEach * Math.max(0, blocks.length - 1)
  let by = contentTop + Math.max(0, avail - consumed) * 0.45
  for (const block of blocks) {
    block.draw(by)
    by += block.height + gapEach
  }

  // ── 5. 页脚：实线分隔 + › FavsHub 域名（左）+ 青边白卡二维码（右） ──
  ctx.strokeStyle = N.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, qrY - 11.5)
  ctx.lineTo(right, qrY - 11.5)
  ctx.stroke()

  const qrX = right - footerQR
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, qrX, qrY, footerQR, footerQR, 10)
  ctx.fill()
  ctx.strokeStyle = 'rgba(34,211,238,0.4)'
  ctx.lineWidth = 1
  roundRect(ctx, qrX + 0.5, qrY + 0.5, footerQR - 1, footerQR - 1, 10)
  ctx.stroke()
  if (qrImg) ctx.drawImage(qrImg, qrX + 6, qrY + 6, footerQR - 12, footerQR - 12)

  const leftMax = qrX - PAD - 16
  ctx.font = monoFont(12, 700)
  ctx.fillStyle = N.green
  ctx.fillText('›', PAD, qrY + 26)
  const promptW = ctx.measureText('›').width + 6
  ctx.font = font(12, 600)
  ctx.fillStyle = N.text
  const brandW = ctx.measureText('FavsHub').width
  ctx.fillText('FavsHub', PAD + promptW, qrY + 26)
  ctx.fillStyle = N.cyan
  ctx.font = monoFont(11)
  ctx.fillText(ellipsize(ctx, siteHost, leftMax - promptW - brandW - 8), PAD + promptW + brandW + 8, qrY + 26)
  ctx.fillStyle = N.textTer
  ctx.font = font(10)
  ctx.fillText(ellipsize(ctx, '扫码查看通告详情 · 社区众包数据', leftMax), PAD, qrY + 46)
}

/** 暖阳陶土版：白色圆角软卡（阴影对齐 tool.bx9y.com.cn 的 --tb-shadow） */
function drawSoftCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

/** 主绘制流程 · 风格 C（暖阳陶土，大众友好向，对齐 tool.bx9y.com.cn） */
function drawClay(
  ctx: CanvasRenderingContext2D,
  deal: ShareDeal,
  qrImg: HTMLImageElement | null,
  iconImg: HTMLImageElement | null,
  siteHost: string,
): void {
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 背景：暖米白 + 陶土橙双层辉光 + 右下角极淡圆环 ──
  ctx.fillStyle = K.bg
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)
  radialGlow(ctx, 400, 40, 180, 'rgba(217,119,87,0.08)')
  radialGlow(ctx, 30, 580, 200, 'rgba(74,124,89,0.06)')
  ctx.strokeStyle = 'rgba(217,119,87,0.07)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(LOGIC_W - 30, LOGIC_H - 40, 90, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(LOGIC_W - 30, LOGIC_H - 40, 70, 0, Math.PI * 2)
  ctx.stroke()

  // ── 1. 服务商白卡：favicon + 名称 + 血统（软阴影圆角卡）──
  // 品牌露出集中在页脚（F 方块 + FavsHub + 域名），顶部不再重复；
  // 品质 pill 收进服务商卡内右侧；服务商是卡片主角，卡体加大
  const cardY = PAD
  const CARD_H = 76
  drawSoftCard(ctx, PAD, cardY, right - PAD, CARD_H, 16)

  // 品质 pill：陶土橙软底 + 深陶土字（大圆角，友好感），卡内垂直居中
  const qText = String(deal.quality || '中品')
  ctx.font = font(12, 600)
  const qw = ctx.measureText(qText).width + 26
  const qh = 28
  const qx = right - 14 - qw
  const qy = cardY + (CARD_H - qh) / 2
  ctx.fillStyle = K.claySoft
  roundRect(ctx, qx, qy, qw, qh, 14)
  ctx.fill()
  ctx.fillStyle = K.clayStrong
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(qText, qx + qw / 2, qy + qh / 2 + 0.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (deal.pinned) drawPin(ctx, qx - 16, qy + 5, K.clay)

  const ICON = 50
  const iconY = cardY + (CARD_H - ICON) / 2
  ctx.fillStyle = K.bgAlt
  roundRect(ctx, PAD + 13, iconY, ICON, ICON, 13)
  ctx.fill()
  if (iconImg) {
    ctx.save()
    roundRect(ctx, PAD + 18, iconY + 5, ICON - 10, ICON - 10, 9)
    ctx.clip()
    ctx.drawImage(iconImg, PAD + 18, iconY + 5, ICON - 10, ICON - 10)
    ctx.restore()
  } else {
    ctx.fillStyle = K.clay
    ctx.font = font(20, 600)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initialOf(deal.provider), PAD + 13 + ICON / 2, iconY + ICON / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
  const nameX = PAD + 13 + ICON + 14
  const nameMax = qx - 18 - nameX
  ctx.fillStyle = K.text
  ctx.font = font(18, 600)
  ctx.fillText(ellipsize(ctx, deal.provider || '未命名服务商', nameMax), nameX, cardY + 34)
  ctx.fillStyle = K.textTer
  ctx.font = font(11.5)
  ctx.fillText(
    ellipsize(ctx, `${regionLabel(deal.region)} · ${sourceLabel(deal.source_tag)}`, nameMax),
    nameX,
    cardY + 55,
  )

  // ── 3. 标题：22px 暖棕粗体 ≤2 行 + 陶土橙圆头短杠 ──
  const titleTop = cardY + CARD_H + 18
  ctx.font = font(21, 700)
  const titleLines = wrapText(ctx, deal.title || '', right - PAD, 2)
  const lineH = 28
  ctx.fillStyle = K.text
  titleLines.forEach((line, i) => {
    ctx.fillText(line, PAD, titleTop + 19 + i * lineH)
  })
  const barY = titleTop + titleLines.length * lineH + 8
  ctx.fillStyle = K.clay
  roundRect(ctx, PAD, barY, 42, 4.5, 2.25)
  ctx.fill()
  const headerBottom = barY + 4.5

  // ── 4. 内容块（统计双卡 → 虚线 → 模型 → Nexus 软 pill → 健康度三卡 → 备注） ──
  const footerQR = 72
  const qrY = LOGIC_H - 24 - footerQR
  const contentTop = headerBottom + 18
  const contentBottom = qrY - 14
  const ratingCount = deal.rating_count || 0
  const average = ratingCount > 0 ? Number(((deal.rating_sum || 0) / ratingCount).toFixed(1)) : null
  const blocks: Block[] = []

  // 4.1 统计：短额度走「免费额度 / 有效期」双白卡陶土橙大数字；
  // 长额度切整宽单卡多行，有效期降为卡内右侧软 pill
  const quotaText = String(deal.quota || '').trim() || '未说明'
  const expiry = expiryText(deal.expires_at)
  const expiryWarn = isExpiringSoon(deal.expires_at)
  const quotaLong = isLongQuota(quotaText)
  ctx.font = font(12.5, 500)
  const quotaLines = quotaLong ? wrapText(ctx, quotaText, right - PAD - 26, QUOTA_WRAP_LINES) : []
  blocks.push({
    height: quotaLong ? 48 + (quotaLines.length - 1) * 17 : 56,
    gap: 0,
    draw: (top) => {
      if (!quotaLong) {
        const gap = 14
        const cw = (right - PAD - gap) / 2
        const cells = [
          { label: '免费额度', value: quotaText, warn: false, fg: K.clay, icon: 'coin' as const, iconColor: K.clay },
          { label: '有效期', value: expiry, warn: expiryWarn, fg: expiryWarn ? K.warn : K.text, icon: 'cal' as const, iconColor: expiryWarn ? K.warn : K.textTer },
        ]
        cells.forEach((cell, i) => {
          const cx0 = PAD + i * (cw + gap)
          drawSoftCard(ctx, cx0, top, cw, 56, 14)
          if (cell.icon === 'coin') drawCoin(ctx, cx0 + 17, top + 15, 4, cell.iconColor, 1.3)
          else drawCalendar(ctx, cx0 + 12.5, top + 10.5, 9, cell.iconColor)
          ctx.fillStyle = K.textTer
          ctx.font = font(10)
          ctx.fillText(cell.label, cx0 + 26, top + 18)
          let vSize = i === 0 ? 19 : 15
          ctx.font = font(vSize, 700)
          while (vSize > 12 && ctx.measureText(cell.value).width > cw - 24) {
            vSize -= 1
            ctx.font = font(vSize, 700)
          }
          ctx.fillStyle = cell.fg
          ctx.fillText(ellipsize(ctx, cell.value, cw - 24), cx0 + 12, top + 43)
        })
        return
      }
      // 长额度：整宽单卡（标签行含右侧有效期软 pill + 换行正文）
      const cw = right - PAD
      const ch = 48 + (quotaLines.length - 1) * 17
      drawSoftCard(ctx, PAD, top, cw, ch, 14)
      drawCoin(ctx, PAD + 17, top + 15, 4, K.clay, 1.3)
      ctx.fillStyle = K.textTer
      ctx.font = font(10)
      ctx.fillText('免费额度', PAD + 26, top + 18)
      // 右侧有效期软 pill
      const pillText = expiry
      ctx.font = font(11, 600)
      const pw = ctx.measureText(pillText).width + 20
      const ph = 22
      const px = right - 13 - pw
      const py = top + 11
      ctx.fillStyle = expiryWarn ? K.warnSoft : K.claySoft
      roundRect(ctx, px, py, pw, ph, 11)
      ctx.fill()
      ctx.fillStyle = expiryWarn ? K.warn : K.clayStrong
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(pillText, px + pw / 2, py + ph / 2 + 0.5)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = K.text
      ctx.font = font(12.5, 500)
      quotaLines.forEach((line, i) => {
        ctx.fillText(line, PAD + 13, top + 38 + i * 17)
      })
    },
  })

  // 4.2 虚线分隔
  blocks.push({
    height: 10,
    gap: 0,
    draw: (top) => {
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = K.borderStrong
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD, top + 5.5)
      ctx.lineTo(right, top + 5.5)
      ctx.stroke()
      ctx.restore()
    },
  })

  // 4.3 模型标签（米灰软 chips，首枚陶土橙软底）
  const models = (deal.models || []).map((m) => String(m)).filter(Boolean)
  if (models.length) {
    const chipH = 24
    const items = models.length <= 4 ? models : [...models.slice(0, 3), `+${models.length - 3}`]
    blocks.push({
      height: chipH,
      gap: 0,
      draw: (top) => {
        ctx.font = font(11)
        let cx = PAD
        items.forEach((m, i) => {
          const w = ctx.measureText(m).width + 20
          if (cx + w > right) return
          const first = i === 0
          ctx.fillStyle = first ? K.claySoft : K.bgAlt
          roundRect(ctx, cx, top, w, chipH, 12)
          ctx.fill()
          ctx.fillStyle = first ? K.clayStrong : K.textSec
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(m, cx + w / 2, top + chipH / 2 + 0.5)
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
          cx += w + 7
        })
      },
    })
  }

  // 4.4 Nexus 实测：鼠尾草绿软 pill 通栏（友好圆角 + 绿圆点）
  const nexus = deal.nexus
  if (nexus) {
    const text = !nexus.enabled
      ? 'Nexus 已禁用'
      : nexus.eval_total > 0
        ? `Nexus 实测 ${nexus.eval_ok}/${nexus.eval_total}${nexus.eval_avg_ms > 0 ? ` · 均 ${speedText(nexus.eval_avg_ms)}` : ''}`
        : 'Nexus 已接入 · 暂无探测数据'
    blocks.push({
      height: 30,
      gap: 0,
      draw: (top) => {
        const bw = right - PAD
        ctx.fillStyle = nexus.enabled ? K.sageSoft : K.bgAlt
        roundRect(ctx, PAD, top, bw, 30, 15)
        ctx.fill()
        ctx.fillStyle = nexus.enabled ? K.sage : K.textTer
        ctx.beginPath()
        ctx.arc(PAD + 17, top + 15, 3.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.font = font(11.5, 500)
        ctx.fillText(text, PAD + 28, top + 19.5)
      },
    })
  }

  // 4.5 社区健康度：三张白卡（绿/红/琥珀数字 + 软阴影）
  const healthCells = [
    { num: String(deal.vote_up || 0), label: '还能用', fg: K.sage },
    { num: String(deal.vote_down || 0), label: '已失效', fg: K.danger },
    {
      num: average === null ? '—' : `★ ${average}`,
      label: ratingCount > 0 ? `${ratingCount} 人评测` : '暂无评测',
      fg: K.warn,
    },
  ]
  blocks.push({
    height: 56,
    gap: 0,
    draw: (top) => {
      const gap = 10
      const cw = (right - PAD - gap * 2) / 3
      healthCells.forEach((cell, i) => {
        const cx0 = PAD + i * (cw + gap)
        drawSoftCard(ctx, cx0, top, cw, 56, 14)
        const cx = cx0 + cw / 2
        ctx.textAlign = 'center'
        ctx.fillStyle = cell.fg
        ctx.font = font(19, 700)
        ctx.fillText(cell.num, cx, top + 28)
        ctx.fillStyle = K.textTer
        ctx.font = font(9.5)
        ctx.fillText(cell.label, cx, top + 45)
        ctx.textAlign = 'left'
      })
    },
  })

  // 4.6 备注（陶土橙标签 + 暖灰正文）
  const note = String(deal.note || '').replace(/\s+/g, ' ').trim()
  if (note) {
    blocks.push({
      height: 18,
      gap: 0,
      draw: (top) => {
        const baseline = top + 13
        ctx.fillStyle = K.clay
        ctx.font = font(10.5, 600)
        ctx.fillText('备注', PAD, baseline)
        ctx.fillStyle = K.textSec
        ctx.font = font(11.5)
        ctx.fillText(ellipsize(ctx, note, right - PAD - 62), PAD + 62, baseline)
      },
    })
  }

  // 4.7 稀疏兜底：字段少（≤3 块）时补虚线提示卡
  if (blocks.length <= 3) {
    blocks.push({
      height: 34,
      gap: 0,
      draw: (top) => {
        ctx.save()
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = K.borderStrong
        ctx.lineWidth = 1
        roundRect(ctx, PAD + 0.5, top + 0.5, right - PAD - 1, 33, 12)
        ctx.stroke()
        ctx.restore()
        ctx.fillStyle = K.textTer
        ctx.font = font(11)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('更多权益与接入方式 · 扫码查看详情', (PAD + right) / 2, top + 17.5)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
      },
    })
  }

  // 统一节奏：基础 12 + 均摊（上限 26），剩余空白 0.45 偏上居中
  const GAP_BASE = 12
  const GAP_MAX = 26
  const sumHeights = blocks.reduce((sum, b) => sum + b.height, 0)
  const avail = contentBottom - contentTop
  const gapEach = blocks.length > 1
    ? Math.min(GAP_MAX, GAP_BASE + Math.max(0, (avail - sumHeights - GAP_BASE * (blocks.length - 1)) / (blocks.length - 1)))
    : 0
  const consumed = sumHeights + gapEach * Math.max(0, blocks.length - 1)
  let by = contentTop + Math.max(0, avail - consumed) * 0.45
  for (const block of blocks) {
    block.draw(by)
    by += block.height + gapEach
  }

  // ── 5. 页脚：实线分隔 + 陶土橙品牌块 + 白卡二维码 ──
  ctx.strokeStyle = K.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, qrY - 11.5)
  ctx.lineTo(right, qrY - 11.5)
  ctx.stroke()

  const qrX = right - footerQR
  ctx.fillStyle = K.surface
  roundRect(ctx, qrX, qrY, footerQR, footerQR, 12)
  ctx.fill()
  ctx.strokeStyle = K.borderStrong
  ctx.lineWidth = 1
  roundRect(ctx, qrX + 0.5, qrY + 0.5, footerQR - 1, footerQR - 1, 12)
  ctx.stroke()
  if (qrImg) ctx.drawImage(qrImg, qrX + 6, qrY + 6, footerQR - 12, footerQR - 12)

  ctx.fillStyle = K.clay
  roundRect(ctx, PAD, qrY + 15, 24, 24, 8)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.font = font(12, 700)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('F', PAD + 12, qrY + 27.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  const fbX = PAD + 34
  const leftMax = qrX - fbX - 12
  ctx.fillStyle = K.text
  ctx.font = font(12.5, 600)
  const fbW = ctx.measureText('FavsHub').width
  ctx.fillText('FavsHub', fbX, qrY + 33)
  ctx.fillStyle = K.textSec
  ctx.font = font(11.5)
  ctx.fillText(ellipsize(ctx, siteHost, leftMax - fbW - 8), fbX + fbW + 8, qrY + 33)
  ctx.fillStyle = K.textTer
  ctx.font = font(10)
  ctx.fillText(ellipsize(ctx, '扫码查看通告详情 · 社区众包数据', leftMax), fbX, qrY + 54)
}

/**
 * 生成分享卡片画布。字体与图片资源就绪后一次性绘制，返回 900×1200 画布。
 */
export async function buildDealShareCanvas(
  deal: ShareDeal,
  options: BuildShareOptions = {},
): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined') throw new Error('分享卡片仅支持在浏览器中生成')
  const canvas = document.createElement('canvas')
  canvas.width = LOGIC_W * SCALE
  canvas.height = LOGIC_H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法生成分享卡片')
  ctx.scale(SCALE, SCALE)

  // 字体就绪后再测量文本，避免首屏字体未加载导致排版错位
  try {
    await (document as any).fonts?.ready
  } catch { /* 忽略：字体 API 不可用时按系统默认字体绘制 */ }

  const [qrImg, iconImg] = await Promise.all([
    options.qrDataUrl ? loadImage(options.qrDataUrl) : Promise.resolve(null),
    options.iconUrl ? loadImage(options.iconUrl) : Promise.resolve(null),
  ])

  const DRAWERS: Record<ShareCardStyle, typeof drawMagazine> = {
    magazine: drawMagazine,
    neon: drawNeon,
    clay: drawClay,
  }
  const draw = DRAWERS[options.style || 'magazine'] || drawMagazine
  draw(ctx, deal, qrImg, iconImg, options.siteHost || 'FavsHub')
  return canvas
}

/** 画布导出 PNG Blob */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('图片导出失败'))
    }, 'image/png')
  })
}

/** 生成二维码位图 dataURL（qrcode 按需动态加载，不进入首屏包） */
export async function makeQrDataUrl(text: string, size = 336): Promise<string> {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(text, {
    width: size,
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: `${C.qr}FF`, light: '#FFFFFFFF' },
  })
}

/** 详情页可分享地址（扫码落地即打开对应详情弹窗） */
export function buildShareUrl(dealId: string, origin: string): string {
  const base = (origin || '').replace(/\/+$/, '')
  return `${base}/tokens?deal=${encodeURIComponent(dealId)}`
}

/** 下载文件名（去掉路径不安全字符；非默认风格带风格后缀） */
export function shareFileName(dealId: string, style: ShareCardStyle = 'magazine'): string {
  const safe = String(dealId).replace(/[^\w.-]+/g, '_').slice(0, 60)
  const suffix = style === 'magazine' ? '' : `-${style}`
  return `favshub-token-deal-${safe}${suffix}.png`
}
