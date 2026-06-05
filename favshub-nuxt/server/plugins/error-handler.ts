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
    setResponseStatus(event, statusCode)

    // 提取错误消息
    const data = (error as any).data
    const errorMsg = data?.error || error.message || '服务器内部错误'

    // 设置 JSON 响应头
    setResponseHeader(event, 'content-type', 'application/json')

    // 发送干净的错误响应（与旧 Express API 完全兼容）
    event.node.res.end(JSON.stringify({ error: errorMsg }))

    // 阻止 H3 的默认错误处理（避免重复响应）
    event._handled = true
  })
})
