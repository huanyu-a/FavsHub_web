/**
 * Token 通告分享卡片 — **服务端渲染器**（AI 技能通道用）
 *
 * 与网页分享面板共用同一份绘制核心 `utils/deal-share-draw.ts`
 * （`drawShareCard` 只吃 `ctx`，浏览器与 @napi-rs/canvas 各传各的）。
 *
 * 依赖：
 *   - `@napi-rs/canvas` —— musl 有预编译二进制，**无需编译工具链**；
 *   - 系统 CJK 字体（容器内由 Dockerfile 装 `font-noto-cjk`，Dockerfile 见仓库根）。
 *
 * 设计要点：
 *   1. **字体注册是进程级一次性**：重复注册会拖慢首次请求，用模块级标记守卫。
 *   2. **CJK 字体必须在字体栈内**：卡片里中文占比高，字体栈若全是西文族，
 *      中文会渲染成豆腐块。`deal-share-draw.ts` 的 FONT_STACK 已含中文字族，
 *      服务端把 Noto Sans CJK 注册成同名族，使其被该栈命中。
 *   3. **二维码 / favicon 走本地资源**：favicon 复用站点已缓存的
 *      `.output/public/images/favicons/<host>.png`，不新增外网抓取（避免 SSRF 面）。
 *   4. **结果做 LRU 缓存**：按 `deal_id + style + updated_at` 命中，
 *      避免同一通告被反复渲染（渲染单张约 100~300ms）。
 */
import { createCanvas, Image, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas'
import { existsSync, readFileSync } from 'node:fs'
import { LRUCache } from 'lru-cache'
import QRCode from 'qrcode'
import {
  SHARE_CARD_W,
  SHARE_CARD_H,
  SHARE_LOGIC_W,
  SHARE_LOGIC_H,
  drawShareCard,
  type ShareCardStyle,
  type ShareDeal,
} from '../../utils/deal-share-draw'

const SCALE = SHARE_CARD_W / SHARE_LOGIC_W

/** 字体族名 —— 必须出现在 deal-share-draw.ts 的 FONT_STACK / MONO_STACK 内才会被命中 */
const CJK_FAMILIES = ['Noto Sans CJK SC', 'Noto Sans CJK JP', 'Microsoft YaHei', 'PingFang SC']

/**
 * 候选字体路径（按序探测）。
 * 线上容器由 Dockerfile 装 font-noto-cjk；本机 macOS/Windows 各有系统字体，
 * 便于「不经容器」也能跑（如本地验证脚本）。
 */
const FONT_CANDIDATES: string[] = [
  '/usr/share/fonts/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  'C:/Windows/Fonts/msyh.ttc',
  '/System/Library/Fonts/PingFang.ttc',
]

let fontsReady = false

/**
 * 注册 CJK 字体（进程级幂等）。
 * 返回是否至少注册成功一个 —— 全失败时不抛错（回退系统默认字体），
 * 但调用方可据此决定是否告警。
 */
export function ensureCardFonts(): boolean {
  if (fontsReady) return true
  fontsReady = true
  let ok = false
  for (const file of FONT_CANDIDATES) {
    if (!existsSync(file)) continue
    for (const family of CJK_FAMILIES) {
      try {
        GlobalFonts.registerFromPath(file, family)
        ok = true
      } catch { /* 单个族注册失败不影响其它 */ }
    }
  }
  return ok
}

/** 等宽字体（neon 风格用）—— 同样需要 CJK 回退 */
const MONO_CANDIDATES: Array<[string, string]> = [
  ['/usr/share/fonts/noto/NotoSansCJK-Regular.ttc', 'Consolas'],
  ['/usr/share/fonts/noto/NotoSansCJK-Regular.ttc', 'Menlo'],
  ['C:/Windows/Fonts/consola.ttf', 'Consolas'],
  ['/System/Library/Fonts/Menlo.ttc', 'Menlo'],
]

/** 注册等宽链（幂等） */
export function ensureMonoFonts(): void {
  for (const [file, family] of MONO_CANDIDATES) {
    if (!existsSync(file)) continue
    try { GlobalFonts.registerFromPath(file, family) } catch { /* ignore */ }
  }
}

// ─── 位图加载（异步解码必须等待，否则 drawImage 拿到空图） ─────────

/** 从 Buffer 解码位图；失败返回 null（绘制层回退占位） */
function decodeImage(buf: Buffer | null): Promise<Image | null> {
  if (!buf) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (v: Image | null) => { if (!settled) { settled = true; resolve(v) } }
    const img = new Image()
    img.onload = () => finish(img)
    img.onerror = () => finish(null)
    // 解码必须走 base64 dataURL 或 Buffer —— napi-rs 两种都支持
    try { img.src = buf } catch { finish(null) }
    setTimeout(() => finish(null), 4000)
  })
}

/** 读取站点已缓存的 favicon（同源本地文件，不走网络） */
function readFavicon(hostname: string, faviconDirs: string[]): Buffer | null {
  const safe = String(hostname || '').replace(/[^a-z0-9.-]/g, '')
  if (!safe) return null
  for (const dir of faviconDirs) {
    const p = `${dir}/${safe}.png`
    try {
      if (existsSync(p)) return readFileSync(p)
    } catch { /* 读取失败继续试下一个 */ }
  }
  return null
}

// ─── 缓存 ───────────────────────────────────────────────────────

/**
 * 渲染结果缓存。
 * key 含 `updated_at` —— 通告改动后 key 变化，自动失效，无需手动清缓存。
 * 上限 120 张（单张 PNG 约 150~240KB → 峰值约 20MB），1 小时 TTL 兜底。
 */
const cardCache = new LRUCache<string, Buffer>({
  max: 120,
  ttl: 60 * 60 * 1000,
})

/** 缓存键：任一字段变化即重渲染 */
export function cardCacheKey(dealId: string, style: ShareCardStyle, updatedAt?: number | null): string {
  return `${dealId}|${style}|${updatedAt ?? 0}`
}

export function getCachedCard(key: string): Buffer | undefined {
  return cardCache.get(key)
}

export function setCachedCard(key: string, buf: Buffer): void {
  cardCache.set(key, buf)
}

// ─── 渲染入口 ───────────────────────────────────────────────────

export interface RenderCardOptions {
  /** 扫码落地地址（详情页绝对 URL） */
  shareUrl: string
  /** 渠道落地域名（用于取本地已缓存 favicon，如 stepfun.com） */
  iconHost?: string | null
  /** 卡片底部展示的站点域名（如 hao.bx9y.com.cn） */
  siteHost: string
  /** 卡片风格，默认 magazine */
  style?: ShareCardStyle
  /** favicon 本地缓存目录候选（按序探测） */
  faviconDirs?: string[]
}

/**
 * 渲染一张通告卡片为 PNG Buffer。
 *
 * 任何图片资源缺失都不影响出图（绘制层有首字母 / 空二维码占位），
 * 只有「画布创建失败」才抛错。
 */
export async function renderDealCard(deal: ShareDeal, options: RenderCardOptions): Promise<Buffer> {
  ensureCardFonts()
  ensureMonoFonts()

  const canvas = createCanvas(SHARE_CARD_W, SHARE_CARD_H)
  const ctx = canvas.getContext('2d') as unknown as SKRSContext2D
  ctx.scale(SCALE, SCALE)

  // 二维码：优先出 buffer（服务端无 dataURL 需求）
  let qrImg: Image | null = null
  try {
    const qrBuf = await QRCode.toBuffer(options.shareUrl, {
      width: 336,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#1C1917FF', light: '#FFFFFFFF' },
    })
    qrImg = await decodeImage(qrBuf)
  } catch { /* 二维码失败不影响卡片主体 */ }

  const iconBuf = options.iconHost
    ? readFavicon(options.iconHost, options.faviconDirs || [])
    : null
  const iconImg = await decodeImage(iconBuf)

  drawShareCard(ctx, deal, {
    qrImg,
    iconImg,
    siteHost: options.siteHost,
    style: options.style,
  })

  return canvas.toBuffer('image/png')
}

/** 从 URL 提取 hostname（用于找本地 favicon），非法则返回 null */
export function hostnameOf(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(String(url)).hostname.toLowerCase()
  } catch {
    return null
  }
}

export { SHARE_CARD_W, SHARE_CARD_H, SHARE_LOGIC_W, SHARE_LOGIC_H }
export type { ShareCardStyle, ShareDeal }
