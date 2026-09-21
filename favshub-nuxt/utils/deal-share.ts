/**
 * Token 通告分享卡片 — **浏览器侧包装**
 *
 * 绘制逻辑已抽到 `utils/deal-share-draw.ts`（前后端共用，纯 Canvas 2D）。
 * 本模块只保留浏览器专属能力：建画布、加载位图、导出 Blob、生成二维码 dataURL。
 *
 * 服务端（AI 技能卡片端点）走 `server/utils/deal-card.ts`，共用同一份绘制核心。
 *
 * 风格切换见 `ShareCardStyle`：magazine（编辑杂志，默认）/ neon（深色终端）/ clay（暖阳陶土）。
 */

import {
  SHARE_CARD_W,
  SHARE_CARD_H,
  SHARE_LOGIC_W,
  SHARE_LOGIC_H,
  drawShareCard,
  type ShareCardStyle,
  type ShareDeal,
} from './deal-share-draw'

export {
  SHARE_CARD_W,
  SHARE_CARD_H,
  SHARE_LOGIC_W,
  SHARE_LOGIC_H,
  drawShareCard,
}
export type {
  ShareCardStyle,
  ShareDeal,
  ShareDealNexus,
} from './deal-share-draw'

const SCALE = 2

export interface BuildShareOptions {
  /** 二维码位图 dataURL（由 makeQrDataUrl 生成） */
  qrDataUrl?: string | null
  /** 渠道 favicon 地址；同源 /api/favicon 代理，加载失败回退首字母 */
  iconUrl?: string | null
  /** 卡片底部展示的站点域名（如 hao.bx9y.com.cn） */
  siteHost?: string
  /** 卡片风格：magazine 编辑杂志（默认）/ neon 深色终端 / clay 暖阳陶土 */
  style?: ShareCardStyle
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

/**
 * 生成分享卡片画布。字体与图片资源就绪后一次性绘制，返回 900×1200 画布。
 */
export async function buildDealShareCanvas(
  deal: ShareDeal,
  options: BuildShareOptions = {},
): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined') throw new Error('分享卡片仅支持在浏览器中生成')
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_LOGIC_W * SCALE
  canvas.height = SHARE_LOGIC_H * SCALE
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

  drawShareCard(ctx, deal, {
    qrImg,
    iconImg,
    siteHost: options.siteHost,
    style: options.style,
  })
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
    color: { dark: '#1C1917FF', light: '#FFFFFFFF' },
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
