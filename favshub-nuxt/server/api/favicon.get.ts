/**
 * GET /api/favicon?domain=hostname — favicon 服务端代理 + 本地缓存（C3）
 *
 * 消除客户端直连 google.com/s2/favicons（国内被墙时请求阻塞 5-10s）：
 *   1. 优先返回本地缓存 /images/favicons/{hostname}.png（已下载过的域名直接 302）
 *   2. 未命中时按 favicon_source_url 配置下载并落盘，再重定向
 *   3. 内网/私有域名一律拒绝（SSRF 防护，DNS 层二次校验见 favicon-download.ts）
 */
import { sendRedirect, createError, getQuery, setResponseHeaders } from 'h3'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { downloadFavicon, isPrivateHostname } from '../utils/favicon-download'
import { getConfig } from '../utils/config'

const FAVICON_DIR = join(process.cwd(), 'public', 'images', 'favicons')

// 同一域名的并发下载去重：多个卡片同时请求未缓存域名时只下载一次
const inflight = new Map<string, Promise<void>>()

// 下载失败的域名短期记忆（C3）：避免每次页面加载都重试下载失败的域名
const failedDomains = new Map<string, number>()
const FAILED_RETRY_MS = 60 * 60 * 1000 // 1 小时后允许重试

function ensureFavicon(safeHostname: string, filepath: string, faviconUrl: string): Promise<void> {
  if (existsSync(filepath)) return Promise.resolve()
  const running = inflight.get(safeHostname)
  if (running) return running
  const p = downloadFavicon(faviconUrl, filepath).finally(() => {
    inflight.delete(safeHostname)
  })
  inflight.set(safeHostname, p)
  return p
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const domain = typeof query.domain === 'string' ? query.domain.trim().toLowerCase() : ''
  if (!domain) {
    throw createError({ statusCode: 400, data: { error: '缺少 domain 参数' } })
  }

  // 净化 hostname：仅允许合法 DNS 字符，防止路径穿越；同时拒绝内网/私有域名
  const safeHostname = domain.replace(/[^a-z0-9.-]/g, '')
  if (!safeHostname || safeHostname.includes('..') || safeHostname.length > 253 || isPrivateHostname(safeHostname)) {
    throw createError({ statusCode: 400, data: { error: '不支持的域名' } })
  }

  const filepath = join(FAVICON_DIR, `${safeHostname}.png`)
  const localPath = `/images/favicons/${safeHostname}.png`

  if (!existsSync(filepath)) {
    // 记忆的失败域名直接 404，避免每次页面加载重试下载
    const lastFailed = failedDomains.get(safeHostname)
    if (lastFailed && Date.now() - lastFailed < FAILED_RETRY_MS) {
      throw createError({ statusCode: 404, data: { error: '图标不可用' } })
    }

    if (!existsSync(FAVICON_DIR)) mkdirSync(FAVICON_DIR, { recursive: true })
    const sourceUrl = getConfig('favicon_source_url') || 'https://www.google.com/s2/favicons?domain={domain}&sz={size}'
    const sz = getConfig('favicon_size') || '32'
    const faviconUrl = sourceUrl.replace('{domain}', safeHostname).replace('{size}', sz)
    try {
      await ensureFavicon(safeHostname, filepath, faviconUrl)
    } catch {
      failedDomains.set(safeHostname, Date.now())
      // 顺手清理过期的失败记忆，防止 Map 无限增长
      const now = Date.now()
      for (const [k, t] of failedDomains) {
        if (now - t >= FAILED_RETRY_MS) failedDomains.delete(k)
      }
      // 下载失败：前端回退到文字首字母占位
      throw createError({ statusCode: 404, data: { error: '图标不可用' } })
    }
  }

  // 302 本身也给 1 小时缓存（覆盖 /api/** 的 no-store），让浏览器缓存重定向，
  // 减少每次页面加载对 /api/favicon 的穿透（C3）
  setResponseHeaders(event, {
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  })

  return sendRedirect(event, localPath, 302)
})
