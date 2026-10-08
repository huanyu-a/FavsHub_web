/**
 * GET /api/token-keys/:id/copy — 复制专用明文端点（2026-10-08 二次调整）。
 *
 * 背景：key 明文绝不允许进入页面渲染层（SSR HTML / Nuxt payload 都不行 ——
 * props 会被序列化进 __NUXT_DATA__）。列表接口不再下发 key_plain；前端点击
 * 「复制 Key」时才来这里取一次明文写入剪贴板。
 *
 * 可见性与列表完全同口径：published、非 dead、回帖指引限 24h —— 不满足一律
 * 404（不区分"不存在"与"不可见"，避免存在性泄露）。无明文的行兜底返回
 * key_masked（历史行），指引行（C 类）无 key 返回 404。
 *
 * 鉴权：无（与公开列表同语义）；限频继承全局 rate-limit 中间件。
 */
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getRawDb } from '../../../database'

/** 与 GET /api/token-keys / 爬虫 GUIDE_WINDOW_SECONDS 同值 */
const GUIDE_WINDOW_SECONDS = 24 * 3600

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') || ''
  if (!/^[\w-]{1,80}$/.test(id)) {
    throw createError({ statusCode: 400, data: { error: 'id 格式非法' } })
  }

  const guideCutoff = Math.floor(Date.now() / 1000) - GUIDE_WINDOW_SECONDS
  const row = getRawDb().prepare(
    'SELECT key_plain, key_masked, deal_status, verdict, source, first_seen_at'
    + ' FROM token_keys WHERE id = ?',
  ).get(id) as {
    key_plain: string | null
    key_masked: string | null
    deal_status: string
    verdict: string
    source: string
    first_seen_at: number | null
  } | undefined

  if (!row
    || row.deal_status !== 'published'
    || row.verdict === 'dead'
    || row.source === 'reply_visible_guide' // C 类指引行没有 key 数据，永不提供复制
    || (row.source === 'reply_visible_guide'
      && !(row.first_seen_at && row.first_seen_at > guideCutoff))) {
    throw createError({ statusCode: 404, data: { error: 'Key 不存在或已下架' } })
  }

  const plain = String(row.key_plain || '').trim()
  const masked = String(row.key_masked || '').trim()
  if (!plain && !masked) {
    // 无任何 key 数据的行不该出现在复制链路里（可见但不可复制）
    throw createError({ statusCode: 404, data: { error: '该行没有可复制的 Key' } })
  }
  return { key_plain: plain || masked }
})
