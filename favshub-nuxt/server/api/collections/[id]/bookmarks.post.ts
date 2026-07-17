/**
 * POST /api/collections/:id/bookmarks — 向精选集添加书签
 * Body: { bookmark_id, category_id? }
 * 或: { title, url, icon?, description?, category_id? }（自动写入所有者公共池再引用）
 * 或批量: { bookmarks: [...] }
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { getRouterParam } from 'h3'
import { insertCollectionBookmarks, isDangerUrl } from '../../../utils/collection-bookmarks'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '缺少精选集 ID' } })
  }

  const body = await readBody(event)
  if (!body) {
    throw createError({ statusCode: 400, data: { error: '缺少请求体' } })
  }

  const db = getRawDb()

  const collection = db.prepare('SELECT id, user_id FROM collections WHERE id = ?').get(id) as any
  if (!collection) {
    throw createError({ statusCode: 404, data: { error: '精选集不存在' } })
  }
  if (collection.user_id !== user.id) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as any
    if (!dbUser?.is_admin) {
      throw createError({ statusCode: 403, data: { error: '无权修改此精选集' } })
    }
  }

  const bookmarks = body.bookmarks || [body]
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
    throw createError({ statusCode: 400, data: { error: '请提供至少一个书签' } })
  }

  for (const b of bookmarks) {
    if (b.url && isDangerUrl(b.url)) {
      throw createError({ statusCode: 400, data: { error: `不支持的 URL 协议: ${b.url}` } })
    }
    if (!b.bookmark_id && !b.url) {
      throw createError({ statusCode: 400, data: { error: '需要 bookmark_id 或 url' } })
    }
  }

  const now = Date.now()
  const updateCount = db.prepare('UPDATE collections SET bookmark_count = bookmark_count + ?, updated_at = ? WHERE id = ?')

  const added = db.transaction(() => {
    const n = insertCollectionBookmarks(db, {
      collectionId: id,
      ownerUserId: collection.user_id,
      bookmarks,
      now,
    })
    if (n > 0) updateCount.run(n, now, id)
    return n
  })()

  return { success: true, added }
})
