/**
 * CORS middleware — 允许浏览器扩展跨域访问 API
 * 支持动态 Origin 白名单（通过 runtimeConfig.corsOrigin 配置）
 *
 * 安全策略：
 * - corsOrigin 为具体域名（逗号分隔）→ 仅允许白名单中的 Origin
 * - corsOrigin 为 'extension' → 仅允许 chrome-extension:// 和 moz-extension:// 协议
 * - corsOrigin 为 '*' → 允许所有 Origin（不安全，仅开发环境使用，且不发送 credentials）
 * - corsOrigin 为空 → 同源策略（不设置 CORS 头）
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const allowedOrigin = (config.corsOrigin || '').trim()

  // 解析请求来源
  const origin = getRequestHeader(event, 'origin') || ''
  const isExtension = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')

  /**
   * 判断请求 Origin 是否允许
   */
  function isAllowedOrigin(origin: string): boolean {
    if (!allowedOrigin || !origin) return false
    if (allowedOrigin === '*') return true
    // 扩展协议始终允许
    if (isExtension) return true
    // 逗号分隔白名单
    const whitelist = allowedOrigin.split(',').map(s => s.trim()).filter(Boolean)
    return whitelist.includes(origin)
  }

  function applyCorsHeaders() {
    if (allowedOrigin === '*') {
      setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
    } else if (isAllowedOrigin(origin)) {
      setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
      setResponseHeader(event, 'Vary', 'Origin')
    }
  }

  if (event.method === 'OPTIONS') {
    applyCorsHeaders()
    setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization')
    setResponseHeader(event, 'Access-Control-Max-Age', '86400')
    return sendNoContent(event)
  }

  applyCorsHeaders()
})
