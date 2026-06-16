/**
 * GET /api/config/baidu-app-key — 获取百度 App Key（仅认证用户）
 */
import { requireAdmin } from '../../utils/auth'
import { getConfig } from '../../utils/config'

export default defineEventHandler((event) => {
  requireAdmin(event) // 仅管理员可访问
  return { key: getConfig('baiduAppKey') }
})
