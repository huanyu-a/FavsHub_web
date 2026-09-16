/**
 * POST /api/token-deals/:id/import — 把通告的领取地址导入为个人书签
 *
 * 与精选集导入保持一致的语义：按归一化 URL 去重，已存在则跳过且不覆盖原书签。
 * 海外来源的通告自动置 need_proxy=1，与站内「需代理」徽章呼应。
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { normalizeUrl } from '../../../utils/bookmark-labels'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }
  const { user, isAdmin } = role

  const { id } = getRouterParams(event)
  const db = getRawDb()

  const deal = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(id) as any
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }
  if (deal.status !== 'approved' && deal.user_id !== user.id && !isAdmin) {
    throw createError({ statusCode: 403, data: { error: '该通告尚未通过审核' } })
  }

  const url = normalizeUrl(deal.url)
  const existing = db.prepare(
    'SELECT id FROM bookmarks WHERE user_id = ? AND url = ?'
  ).get(user.id, url) as { id: number } | undefined

  if (existing) {
    return {
      success: true,
      skipped: true,
      bookmark_id: existing.id,
      message: '该地址已在你的书签中',
    }
  }

  const now = Date.now()
  const bookmarkTitle = `${deal.provider} - ${deal.title}`.slice(0, 200)
  const description = [deal.quota, deal.note].filter(Boolean).join(' · ').slice(0, 500)

  try {
    const result = db.prepare(`
      INSERT INTO bookmarks
        (user_id, title, url, folder_id, icon, description, login_required, label, need_proxy, source, created_at, updated_at)
      VALUES (?, ?, ?, NULL, '', ?, 0, 'import', ?, ?, ?, ?)
    `).run(
      user.id,
      bookmarkTitle,
      url,
      description,
      deal.region === 'global' ? 1 : 0,
      JSON.stringify(['token-deal']),
      now,
      now,
    )

    return {
      success: true,
      skipped: false,
      bookmark_id: Number(result.lastInsertRowid),
      message: '已导入到我的书签',
    }
  } catch (err: any) {
    console.error('导入通告书签失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '导入失败' } })
  }
})
