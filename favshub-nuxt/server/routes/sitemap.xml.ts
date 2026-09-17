/**
 * sitemap.xml - 站点地图生成
 * 包含首页、精选集市场页、Token 白嫖通告页、所有公开精选集详情页
 */
import { getRawDb } from '../database'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const baseUrl = config.public.baseUrl || 'https://hao.bx9y.com.cn'

  let collections: Array<{ id: string; updated_at: number; is_official: number }> = []

  try {
    const db = getRawDb()
    collections = db.prepare(`
      SELECT id, updated_at, is_official
      FROM collections
      WHERE is_public = 1
      ORDER BY updated_at DESC
    `).all() as Array<{ id: string; updated_at: number; is_official: number }>
  } catch (err) {
    console.error('Failed to query collections for sitemap:', err)
    // 查询失败时返回最小 sitemap（仅首页）
  }

  const now = new Date().toISOString()

  const urls: Array<{
    loc: string
    lastmod: string
    changefreq?: string
    priority: number
  }> = [
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
      lastmod: new Date(c.updated_at).toISOString(),
      changefreq: 'weekly',
      priority: c.is_official ? 0.9 : 0.7,
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
