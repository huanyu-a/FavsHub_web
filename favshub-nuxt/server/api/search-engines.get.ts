/**
 * GET /api/search-engines — 获取搜索引擎列表（公开接口）
 */
import { getRawDb } from '../database'

export default defineEventHandler(() => {
  const db = getRawDb()

  const engines = db.prepare(`
    SELECT * FROM search_engines
    ORDER BY
      CASE category
        WHEN 'SEARCH' THEN 1
        WHEN 'AI' THEN 2
        WHEN 'SOCIAL' THEN 3
        ELSE 4
      END,
      sort_order,
      id
  `).all()

  return { engines }
})
