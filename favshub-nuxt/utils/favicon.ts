/**
 * 书签图标解析：优先本地 icon；无 icon 时走服务端代理 /api/favicon（含本地缓存与 SSRF 防护）；
 * 内网/私有/沙箱域名不请求外网（避免无意义 404）。
 */

export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.intranet') || h.endsWith('.internal')) {
    return true
  }
  // 常见内网/测试域名
  if (h.includes('.sandbox.') || h.includes('.test.') || h.endsWith('.localdomain')) {
    return true
  }
  // IPv4 私有/环回
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number)
    if (p.some(n => n > 255)) return true
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 169 && p[1] === 254) return true
    return false
  }
  // IPv6 简判
  if (h.includes(':')) return true
  return false
}

/** 返回可用的 icon URL；null 表示使用文字首字母占位 */
export function resolveBookmarkIcon(icon: string | null | undefined, url: string | null | undefined): string | null {
  if (icon && String(icon).trim()) return String(icon).trim()
  if (!url) return null
  try {
    const hostname = new URL(url).hostname
    if (isPrivateOrLocalHost(hostname)) return null
    // C3: 走服务端代理 + 本地缓存，避免客户端直连 Google（国内被墙时请求阻塞）
    return `/api/favicon?domain=${encodeURIComponent(hostname)}`
  } catch {
    return null
  }
}
