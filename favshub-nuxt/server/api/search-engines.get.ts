/**
 * GET /api/search-engines — 获取搜索引擎列表（公开接口）
 * 仅返回已审核通过的引擎
 * 登录用户：按用户自定义排序（settings 中的 search_engine_order）
 * 游客：按全局 sort_order
 */
import { getRawDb } from '../database'
import { optionalAuth } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  let engines = db.prepare(`
    SELECT * FROM search_engines
    WHERE status = 'approved'
    ORDER BY
      CASE category
        WHEN 'SEARCH' THEN 1
        WHEN 'AI' THEN 2
        WHEN 'SOCIAL' THEN 3
        ELSE 4
      END,
      sort_order,
      id
  `).all() as any[]

  // 登录用户：应用用户自定义排序
  if (user) {
    try {
      const settingsRow = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(user.id) as { data: string } | undefined
      if (settingsRow) {
        const userSettings = JSON.parse(settingsRow.data) as Record<string, any>
        const customOrder = userSettings.search_engine_order as number[] | undefined
        if (Array.isArray(customOrder) && customOrder.length > 0) {
          // 按用户自定义顺序排序（不在自定义列表中的排最后）
          const orderMap = new Map(customOrder.map((id, idx) => [id, idx]))
          engines.sort((a, b) => {
            const oa = orderMap.has(a.id) ? orderMap.get(a.id)! : 999
            const ob = orderMap.has(b.id) ? orderMap.get(b.id)! : 999
            return oa - ob
          })
        }
        // 应用用户自定义默认引擎
        const customDefault = userSettings.search_engine_default as string | undefined
        if (customDefault) {
          engines = engines.map(e => ({
            ...e,
            is_default: e.name === customDefault ? 1 : 0,
          }))
        }
      }
    } catch { /* 解析失败忽略，使用默认排序 */ }
  }

  return { engines }
})