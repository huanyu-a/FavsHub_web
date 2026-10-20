/**
 * DELETE /api/admin/token-deals/:id/purge — 彻底删除（物理，仅管理员）
 *
 * Body: { confirm: true } —— 不带 confirm 一律 400（防止误触）。
 *
 * 与软删除（`DELETE /api/token-deals/:id`）的区别：
 *   - 软删除：保留全部明细（投票 / 评测 / 建议 / 打标），可恢复；
 *   - 彻底删除：物理删行并显式清理所有明细表（不依赖 FK 级联 ——
 *     CLI 与部分连接默认 foreign_keys=OFF，级联会静默失效）。
 *
 * 仅用于清理长期无人认领的失效数据；正常处置一律走软删除。
 */
import { getRawDb } from '../../../../database'
import { requireAdmin } from '../../../../utils/auth'
import { purgeDealPermanently } from '../../../../utils/token-deals'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({} as any))

  if (body?.confirm !== true) {
    throw createError({
      statusCode: 400,
      data: { error: '彻底删除不可恢复，必须携带 confirm: true' },
    })
  }

  const db = getRawDb()
  const deal = db.prepare('SELECT id, title FROM token_deals WHERE id = ?').get(id) as any
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  try {
    purgeDealPermanently(db, id)
  } catch (err: any) {
    console.error('彻底删除 Token 白嫖通告失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '彻底删除失败' } })
  }

  return { success: true, purged: id, title: deal.title }
})
