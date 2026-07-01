/**
 * CORS middleware — 允许浏览器扩展跨域访问 API
 * 支持动态 Origin 白名单（通过 runtimeConfig.corsOrigin 配置）
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const allowedOrigin = config.corsOrigin || '*'

  if (event.method === 'OPTIONS') {
    if (allowedOrigin !== '*') {
      const origin = getRequestHeader(event, 'origin')
      if (origin && allowedOrigin.split(',').map(s => s.trim()).includes(origin)) {
        setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
        setResponseHeader(event, 'Vary', 'Origin')
      }
    } else {
      setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
    }
    setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization')
    setResponseHeader(event, 'Access-Control-Max-Age', '86400')
    return sendNoContent(event)
  }

  if (allowedOrigin !== '*') {
    const origin = getRequestHeader(event, 'origin')
    if (origin && allowedOrigin.split(',').map(s => s.trim()).includes(origin)) {
      setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
      setResponseHeader(event, 'Vary', 'Origin')
    }
  } else {
    setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
  }
})
