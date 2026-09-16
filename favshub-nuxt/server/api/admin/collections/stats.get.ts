/**
 * GET /api/admin/collections/stats
 * 获取精选集统计数据
 */
import { getRawDb } from '~/server/database'
import { requireAdmin } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const db = getRawDb()

  try {
    // 总精选集数
    const totalResult = db.prepare('SELECT COUNT(*) as count FROM collections').get() as { count: number }

    // 官方推荐数
    const officialResult = db.prepare('SELECT COUNT(*) as count FROM collections WHERE is_official = 1').get() as { count: number }

    // 总书签数
    const bookmarksResult = db.prepare('SELECT COUNT(*) as count FROM collection_bookmarks').get() as { count: number }

    // 平均书签数
    const avgBookmarks = totalResult.count > 0 ? Math.round(bookmarksResult.count / totalResult.count) : 0

    return {
      total: totalResult.count,
      official: officialResult.count,
      bookmarks: bookmarksResult.count,
      avgBookmarks
    }
  } catch (error: any) {
    console.error('[Admin] 获取精选集统计失败:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch stats',
      data: { error: error.message }
    })
  }
})
