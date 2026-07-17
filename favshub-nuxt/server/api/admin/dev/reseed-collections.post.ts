/**
 * 开发者工具：清空并重新 seed 精选集数据
 * POST /api/admin/dev/reseed-collections
 */
import { getRawDb } from '~/server/database'
import { seedDefaultCollections } from '~/server/utils/seed-collections'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)

  const db = getRawDb()

  try {
    // 清空所有精选集相关数据（事务包裹确保原子性）
    db.transaction(() => {
      db.prepare('DELETE FROM collection_imports').run()
      db.prepare('DELETE FROM collection_subscriptions').run()
      db.prepare('DELETE FROM collection_bookmarks').run()
      db.prepare('DELETE FROM collection_categories').run()
      db.prepare('DELETE FROM collections').run()
    })()

    // 重新 seed
    seedDefaultCollections(db)

    return {
      success: true,
      message: '已清空并重新 seed 精选集数据'
    }
  } catch (error: any) {
    console.error('[Dev] 重新 seed 精选集失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to reseed collections',
      data: { error: error.message }
    })
  }
})
