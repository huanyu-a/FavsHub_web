/**
 * Nitro 服务端插件 — 全局 API 错误格式化
 * 确保所有 API 错误响应格式为 { error: "消息" }，与旧系统兼容
 *
 * ## 安全：出站脱敏（不可移除）
 *
 * 本插件是**所有 API 错误响应的唯一出口**。Node / SQLite / better-sqlite3
 * 抛出的消息天然携带绝对路径（如 `ENOENT ... open '/www/.../favshub.db'`），
 * 若原样回显，部署根路径即外泄给客户端（含 AI 通道）。
 *
 * 因此 **4xx 与 5xx 一律经过 `redactPaths()`**：
 *   - 4xx 保留业务语义（前端需要它提示用户），仅抹去路径；
 *   - 5xx 仍整体替换为通用文案，细节只进服务端日志。
 *
 * 注：技能文档（SKILL.md）是分发给使用者的、可被任意改写，不足以作为安全边界；
 * 真正的约束必须在服务端代码里，即此处。
 */
import { redactPaths } from '../utils/sanitize'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('error', (error, { event }) => {
    // 仅处理 API 路由的错误
    if (!event?.path?.startsWith('/api/')) return

    // 设置响应状态码
    const statusCode = (error as any).statusCode || 500

    // 提取错误消息
    const data = (error as any).data
    let errorMsg = data?.error || error.message || '服务器内部错误'

    if (statusCode >= 500) {
      // 5xx：完整细节只进服务端日志，客户端仅得通用文案
      console.error(`[API Error] ${event.path} ${statusCode}:`, error.message)
      errorMsg = '服务器内部错误'
    }

    // 出站脱敏：抹去消息中的文件系统绝对路径（4xx / 5xx 一律执行）
    errorMsg = redactPaths(errorMsg)

    setResponseStatus(event, statusCode)

    // 设置 JSON 响应头
    setResponseHeader(event, 'content-type', 'application/json')

    // 发送干净的错误响应（与旧 Express API 完全兼容）
    event.node.res.end(JSON.stringify({ error: errorMsg }))

    // 阻止 H3 的默认错误处理（避免重复响应）
    event._handled = true
  })
})
