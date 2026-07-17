/**
 * Nitro 服务端插件 — 全局 API 错误格式化
 * 确保所有 API 错误响应格式为 { error: "消息" }，与旧系统兼容
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('error', (error, { event }) => {
    // 仅处理 API 路由的错误
    if (!event?.path?.startsWith('/api/')) return

    // 设置响应状态码
    const statusCode = (error as any).statusCode || 500

    // 提取错误消息
    const data = (error as any).data
    let errorMsg = data?.error || error.message || '服务器内部错误'

    // 生产环境安全：5xx 错误不暴露内部细节，仅记录服务端日志
    // 设计选择：4xx 错误直接返回原始 errorMsg（可能包含 SQL 错误文本等细节），
    // 因为 4xx 是客户端错误，前端通常需要这些信息来提示用户修正操作。
    // 这是有意的取舍——便利性优先于信息脱敏。如需收紧，可在此处对 4xx 也做白名单过滤。
    if (statusCode >= 500) {
      console.error(`[API Error] ${event.path} ${statusCode}:`, error.message)
      errorMsg = '服务器内部错误'
    }

    setResponseStatus(event, statusCode)

    // 设置 JSON 响应头
    setResponseHeader(event, 'content-type', 'application/json')

    // 发送干净的错误响应（与旧 Express API 完全兼容）
    event.node.res.end(JSON.stringify({ error: errorMsg }))

    // 阻止 H3 的默认错误处理（避免重复响应）
    event._handled = true
  })
})
