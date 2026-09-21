/**
 * GET /api/ai/token-deals/:id/card.png — 通告分享卡片（PNG 二进制）
 *
 * 供 AI 技能/客户端直接拉取图片：卡片绘制逻辑与网页分享面板**完全同源**
 * （共用 `utils/deal-share-draw.ts`），故技能产出的卡片与站点一致。
 *
 * 查询参数：
 *   - `style` = magazine（默认）| neon | clay
 *   - `refresh=1` 跳过缓存强制重渲染（用于调试）
 *
 * 鉴权：read scope。图片本身是公开通告的展示物，但仍走 PAT —— 防止匿名刷图
 * 消耗服务端 CPU（单张渲染 100~300ms）。
 *
 * 可见性规则与详情端点一致：未审核通过的通告仅作者与管理员可取。
 */
import { defineAiHandler } from '../../../../utils/ai-auth'
import { getRawDb } from '../../../../database'
import { isUserAdmin } from '../../../../utils/ai-service'
import { getFaviconDir } from '../../../../utils/favicon-dir'
import { join } from 'node:path'
import { getRouterParams, getQuery, setResponseHeaders, createError } from 'h3'
import {
  renderDealCard,
  cardCacheKey,
  getCachedCard,
  setCachedCard,
  hostnameOf,
  type ShareCardStyle,
} from '../../../../utils/deal-card'

const VALID_STYLES: ShareCardStyle[] = ['magazine', 'neon', 'clay']

function parseModels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 读取通告的 Nexus 渠道信息（表未迁移或异常时返回 null，不阻断出图） */
function loadNexusInfo(db: any, dealId: string) {
  try {
    const row = db.prepare(`
      SELECT n.channel_id, n.name, n.status, n.eval_ok, n.eval_total, n.eval_avg_ms, n.eval_at
      FROM nexus_deal_map m
      JOIN nexus_channels n ON n.channel_id = m.channel_id
      WHERE m.deal_id = ?
    `).get(dealId) as any
    if (!row) return null
    return {
      enabled: row.status === 1,
      eval_ok: row.eval_ok || 0,
      eval_total: row.eval_total || 0,
      eval_avg_ms: row.eval_avg_ms || 0,
    }
  } catch {
    return null
  }
}

export default defineAiHandler('read', async (event, token) => {
  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '缺少通告 ID' } })
  }

  const query = getQuery(event)
  const styleRaw = String(query.style || 'magazine').toLowerCase()
  const style: ShareCardStyle = VALID_STYLES.includes(styleRaw as ShareCardStyle)
    ? (styleRaw as ShareCardStyle)
    : 'magazine'

  const db = getRawDb()
  const row = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(id) as any
  if (!row) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  // 可见性：未审核通过的通告仅作者与管理员可见
  const isOwner = row.user_id === token.user_id
  const isAdmin = isUserAdmin(db, token.user_id)
  if (row.status !== 'approved' && !isOwner && !isAdmin) {
    throw createError({ statusCode: 403, data: { error: '该通告尚未通过审核' } })
  }

  const config = useRuntimeConfig(event)
  const baseUrl = String(config.public.baseUrl || '').replace(/\/+$/, '')
  const shareUrl = `${baseUrl}/tokens?deal=${encodeURIComponent(id)}`
  const siteHost = hostnameOf(baseUrl) || 'FavsHub'

  // 缓存命中：通告更新（updated_at 变化）后 key 自然失效
  const refresh = String(query.refresh || '') === '1'
  const key = cardCacheKey(id, style, row.updated_at)
  let png = refresh ? undefined : getCachedCard(key)
  const cacheHit = !!png

  if (!png) {
    png = await renderDealCard(
      {
        id: row.id,
        provider: row.provider,
        title: row.title,
        url: row.url,
        call_url: row.call_url,
        quota: row.quota,
        models: parseModels(row.models),
        region: row.region,
        quality: row.quality,
        source_tag: row.source_tag,
        expires_at: row.expires_at,
        pinned: row.pinned,
        note: row.note,
        vote_up: row.vote_up,
        vote_down: row.vote_down,
        rating_sum: row.rating_sum,
        rating_count: row.rating_count,
        nexus: loadNexusInfo(db, id),
      },
      {
        shareUrl,
        iconHost: hostnameOf(row.url),
        siteHost,
        style,
        // 站点 favicon 缓存目录（与 /api/favicon 写同一处）
        faviconDirs: [
          getFaviconDir(),
          join(process.cwd(), 'public', 'images', 'favicons'),
        ],
      },
    )
    setCachedCard(key, png)
  }

  setResponseHeaders(event, {
    'content-type': 'image/png',
    'content-length': String(png.length),
    // 私有缓存：卡片内容随通告变化，且带鉴权，不适合共享缓存
    'cache-control': 'private, max-age=300',
    // 便于技能侧核对风格与缓存状态
    'x-card-style': style,
    'x-card-cached': cacheHit ? 'hit' : 'miss',
  })

  return png
})
