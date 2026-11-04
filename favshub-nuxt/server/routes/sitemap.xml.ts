/**
 * sitemap.xml - 站点地图生成
 *
 * 收录：首页、精选集市场页、Token 白嫖通告列表页、福利 Key 页、提示词库页、
 * 所有公开精选集详情页，以及**伪静态详情页**：
 *   - 公开可见的通告      → /tokens/<dealId>.html
 *   - 游客可读的提示词    → /prompts/<promptId>.html
 *
 * 为什么要把详情页收进来：详情页改成 `/xxx/<id>.html` 这种「制造出来的新地址」后，
 * 如果没有任何对外发现路径（sitemap / RSS / 站内链），搜索引擎不会主动去猜 ——
 * 伪静态就等于白做。sitemap 是爬虫最高频的入口，这里必须给出新形态的地址。
 *
 * ## 可见性口径（关键：不得把不可见条目收进 sitemap）
 * - 通告：`status='approved'` + 未软删除 + 未失效 + 未过期。
 *   直接复用 `server/utils/token-deals.ts` 的 `publicVisibleClause()`，
 *   与 `/api/token-deals` 公开列表、列表页、详情页**共用同一份口径**，不另写一套。
 * - 提示词：与 `/api/prompts` 的**游客**可见口径一致（公开 + 管理员发布 + 未软删除
 *   + 不在「锁定文件夹」内）。锁定文件夹的递归 CTE 与 server/api/prompts/index.get.ts
 *   是同一份逻辑 —— 那边若调整需同步这里；不一致的最坏后果是 sitemap 收录了一个
 *   游客打不开的地址（详情页本身仍按接口口径 403，不会泄露内容）。
 *
 * ## 性能取舍（爬虫高频入口，不能变慢查询）
 * - 只取 `id` 与 `updated_at` 两列，不 SELECT *、不渲染 note_html；
 * - WHERE 命中现有索引 `idx_td_visible(status, deleted_at, invalid_at, expires_at)`；
 * - **单次输出上限**：通告 2000 条、提示词 1000 条，按 updated_at 倒序取（最新优先）。
 *   这样单文件 URL 数远低于 sitemap 协议上限（50,000 条 / 50MB），响应体约 300KB 量级。
 *   超出上限的旧条目不会进 sitemap，但仍可通过 RSS/Atom（`/api/token-deals/feed.*`）
 *   与站内链接被发现；若将来条目量级超过上限，再按协议拆 sitemap 索引（sitemapindex）。
 */
import { getRawDb } from '../database'
import { DEAL_CATEGORY_ROUTES } from '../../utils/deal-categories'
import { publicVisibleClause } from '../utils/token-deals'

/** sitemap 单次输出的详情条数上限（见文件头「性能取舍」） */
const MAX_DEALS = 2000
const MAX_PROMPTS = 1000

interface SitemapEntry {
  loc: string
  lastmod: string
  changefreq?: string
  priority: number
}

interface DetailRow {
  id: string
  updated_at: number | null
}

/** 毫秒时间戳 → ISO；缺失/非法值退化为当前时间，避免 toISOString() 抛 RangeError */
function toIso(ts: number | null | undefined, fallback: string): string {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return fallback
  try {
    return new Date(n).toISOString()
  } catch {
    return fallback
  }
}

/** 公开可见的通告（与公开列表同一口径，复用 publicVisibleClause 防止两处漂移） */
function loadPublicDeals(db: any): DetailRow[] {
  const params: any[] = []
  const where = '1=1' + publicVisibleClause('d', params)
  params.push(MAX_DEALS)
  return db.prepare(`
    SELECT d.id AS id, COALESCE(d.updated_at, d.created_at) AS updated_at
    FROM token_deals d
    WHERE ${where}
    ORDER BY d.updated_at DESC
    LIMIT ?
  `).all(...params) as DetailRow[]
}

/** 游客可读的提示词（与 /api/prompts 的游客口径一致，见文件头说明） */
function loadPublicPrompts(db: any): DetailRow[] {
  // 锁定文件夹（自身 login_required=1 及其所有后代）
  const lockedFolderIds = (db.prepare(`
    WITH RECURSIVE locked_chain(id) AS (
      SELECT id FROM prompt_folders WHERE login_required = 1
      UNION
      SELECT pf.id FROM prompt_folders pf INNER JOIN locked_chain lc ON pf.parent_id = lc.id
    )
    SELECT id FROM locked_chain
  `).all() as Array<{ id: string }>).map(r => String(r.id))

  let sql = `
    SELECT p.id AS id, COALESCE(p.updated_at, p.created_at) AS updated_at
    FROM prompts p
    INNER JOIN users u ON p.user_id = u.id
    WHERE p.login_required = 0
      AND p.deleted_at IS NULL
      AND u.is_admin = 1`
  const params: any[] = []
  if (lockedFolderIds.length > 0) {
    sql += ` AND (p.folder_id IS NULL OR p.folder_id NOT IN (${lockedFolderIds.map(() => '?').join(',')}))`
    params.push(...lockedFolderIds)
  }
  sql += ' ORDER BY p.updated_at DESC LIMIT ?'
  params.push(MAX_PROMPTS)
  return db.prepare(sql).all(...params) as DetailRow[]
}

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const baseUrl = config.public.baseUrl || 'https://hao.bx9y.com.cn'

  let collections: Array<{ id: string; updated_at: number; is_official: number }> = []
  let deals: DetailRow[] = []
  let prompts: DetailRow[] = []

  try {
    const db = getRawDb()
    collections = db.prepare(`
      SELECT id, updated_at, is_official
      FROM collections
      WHERE is_public = 1
      ORDER BY updated_at DESC
    `).all() as Array<{ id: string; updated_at: number; is_official: number }>

    // 详情页两边各自 try/catch：旧库缺表/缺列时不影响其余段落
    try {
      deals = loadPublicDeals(db)
    } catch (err) {
      console.error('Failed to query token deals for sitemap:', err)
    }
    try {
      prompts = loadPublicPrompts(db)
    } catch (err) {
      console.error('Failed to query prompts for sitemap:', err)
    }
  } catch (err) {
    console.error('Failed to query collections for sitemap:', err)
    // 查询失败时返回最小 sitemap（仅首页）
  }

  const now = new Date().toISOString()

  const urls: SitemapEntry[] = [
    // 首页
    {
      loc: baseUrl,
      lastmod: now,
      priority: 1.0,
    },
    // 精选集市场
    {
      loc: `${baseUrl}/collections`,
      lastmod: now,
      changefreq: 'daily',
      priority: 0.9,
    },
    // Token 白嫖通告（公开页面，时效性强，日更）
    {
      loc: `${baseUrl}/tokens`,
      lastmod: now,
      changefreq: 'daily',
      priority: 0.9,
    },
    // 白嫖分类落地页与精选对比（2026-11-04）：
    // 各自有独立导语 + 分类 FAQ，是「免费 API / 服务器 / 域名」等长尾词的落点，
    // 优先级高于详情页（0.7），与 /tokens 同级。
    // 白嫖分类落地页与精选对比（2026-11-04；2026-11-05 改为派生）：
    // 各自有独立导语 + 分类 FAQ，是「免费 API / 服务器 / 域名」等长尾词的落点，
    // 优先级高于详情页（0.7），与 /tokens 同级。
    //
    // ⚠️ 这里原先手抄了 4 条分类路由，`client` 就漏过一次 —— 服务端 DEAL_CATEGORIES
    // 早有该分类，但首页分类卡、详情页底部导航、本 sitemap 三处都漏，导致 4 条客户端
    // 额度通告没有可被搜索引擎收录的入口页。现在从真源派生，新增分类自动进 sitemap。
    ...DEAL_CATEGORY_ROUTES.map(route => ({
      loc: `${baseUrl}${route}`,
      lastmod: now,
      changefreq: 'daily',
      priority: 0.9,
    })),
    {
      loc: `${baseUrl}/tokens/compare`,
      lastmod: now,
      changefreq: 'daily',
      priority: 0.85,
    },
    // 福利 Key 看板（公开页面，随爬虫轮次日更）
    {
      loc: `${baseUrl}/tokens/keys`,
      lastmod: now,
      changefreq: 'daily',
      priority: 0.8,
    },
    // 提示词管理（公开页面）
    {
      loc: `${baseUrl}/prompts`,
      lastmod: now,
      changefreq: 'daily',
      priority: 0.8,
    },
    // 每个公开精选集
    ...collections.map((c) => ({
      loc: `${baseUrl}/collections/${c.id}`,
      lastmod: toIso(c.updated_at, now),
      changefreq: 'weekly',
      priority: c.is_official ? 0.9 : 0.7,
    })),
    // 伪静态通告详情页（正文由 SSR 渲染，可被直接收录）
    ...deals.map((d) => ({
      loc: `${baseUrl}/tokens/${encodeURIComponent(d.id)}.html`,
      lastmod: toIso(d.updated_at, now),
      changefreq: 'daily',
      priority: 0.7,
    })),
    // 伪静态提示词详情页（游客可读的那些）
    ...prompts.map((p) => ({
      loc: `${baseUrl}/prompts/${encodeURIComponent(p.id)}.html`,
      lastmod: toIso(p.updated_at, now),
      changefreq: 'weekly',
      priority: 0.6,
    })),
  ]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>${u.changefreq ? `
    <changefreq>${u.changefreq}</changefreq>` : ''}
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`

  setHeader(event, 'Content-Type', 'application/xml; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=86400') // 24小时缓存

  return xml
})

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}