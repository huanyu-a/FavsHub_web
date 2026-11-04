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

/**
 * icon 值是否可以直接渲染进 `<img src>`。
 *
 * 背景（2026-11-05 生产数据实测）：原先 `resolveBookmarkIcon` 的做法是
 * 「icon 非空就原样返回」，不做任何形态校验。查了生产全量 2667 条 icon，
 * 实际存在三类不该直接渲染的值：
 *
 *   1. **危险协议**：理论上可写入 `javascript:` / `vbscript:` 等。`<img src>` 不会执行
 *      脚本，但仍是不该出现在 DOM 里的值，且换个渲染位置就成了洞。
 *   2. **相对路径缺前导斜杠**：实测 **30 条** 形如 `img/<32位hex>.webp`。
 *      它会被解析成 `/bookmarks/img/xxx.webp`（相对当前页面），而 `public/img`
 *      根本不存在 —— 这 30 条**全部 404**，用户看到的是坏图标。
 *   3. 白名单外的其它协议（`file:` / `blob:` 等）。
 *
 * 处理策略是**放行可安全渲染的形态，其余一律返回 null 让调用方回落**：
 * 站内绝对路径（`/...`，含落盘的 `/images/favicons/*.png`）、
 * `data:image/*` 内联图标（实测 25 条合法用途）、`http(s)` 外链（实测 10 条）。
 *
 * 刻意**不**在这里把相对路径「补成」绝对路径：`img/xxx.webp` 指向的文件在
 * 站点上根本不存在，补斜杠只会把一个 404 换成另一个 404，还会掩盖上游数据问题。
 * 回落到代理图标（按书签 URL 域名现取）才是对用户有意义的兜底。
 */
export function isRenderableIcon(icon: string | null | undefined): boolean {
  if (!icon) return false
  const s = String(icon).trim()
  if (!s) return false
  // 站内绝对路径（/images/favicons/x.png、/favicon.ico …）
  if (s.startsWith('/') && !s.startsWith('//')) return true
  // 内联图片 data URI —— 必须限定 image/*，不接受 data:text/html
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(s)) return true
  // 绝对 http(s) 地址
  if (/^https?:\/\//i.test(s)) return true
  return false
}

/** 返回可用的 icon URL；null 表示使用文字首字母占位 */
export function resolveBookmarkIcon(icon: string | null | undefined, url: string | null | undefined): string | null {
  // 只渲染形态合法的 icon；坏值（危险协议 / 缺前导斜杠的相对路径 / 未知协议）
  // 一律忽略并回落到按域名取的代理图标 —— 详见 isRenderableIcon 的说明。
  if (isRenderableIcon(icon)) return String(icon).trim()
  if (!url) return null
  const hostname = hostnameFromUrl(url)
  if (!hostname || isPrivateOrLocalHost(hostname)) return null
  // C3: 走服务端代理 + 本地缓存，避免客户端直连 Google（国内被墙时请求阻塞）
  return `/api/favicon?domain=${encodeURIComponent(hostname)}`
}

/** 从 URL 提取 hostname；无效返回 null */
export function hostnameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/** icon 为本地落盘路径（/images/favicons/<host>.png）时取出 hostname，否则 null */
export function hostnameFromLocalIconPath(icon: string | null | undefined): string | null {
  if (!icon) return null
  const m = /^\/images\/favicons\/([A-Za-z0-9.-]+)\.png$/.exec(String(icon).trim())
  return m ? m[1] : null
}

/**
 * 图标加载失败后的自愈地址：转 /api/favicon 代理，服务端发现本地缺文件会自动补下载再 302。
 * 仅对公共域名生效；返回 null 表示无自愈来源（内网/私有、URL 无效等），调用方直接占位。
 */
export function fallbackProxyIcon(icon: string | null | undefined, url: string | null | undefined): string | null {
  const hostname = hostnameFromLocalIconPath(icon) || hostnameFromUrl(url)
  if (!hostname || isPrivateOrLocalHost(hostname)) return null
  return `/api/favicon?domain=${encodeURIComponent(hostname)}`
}
