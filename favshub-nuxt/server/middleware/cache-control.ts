/**
 * HTML 页面级缓存控制中间件 — C1 隐私修正
 *
 * routeRules 对 /** 默认 `private, max-age=60`（浏览器按用户缓存，CDN 不存储），
 * 避免 CDN 忽略 Vary:Cookie 时把登录用户的个性化 HTML（含私有书签标题）串给游客。
 * 此中间件在确认请求为游客（无 favshub_token cookie 且无 Bearer 头）时，
 * 将公开页升级为 `public, max-age=60, s-maxage=120, stale-while-revalidate=300`，
 * 允许 CDN 缓存游客可见的公开页面。
 *
 * API / 静态资源 / 管理后台不在此处理（各自 routeRules 已覆盖）。
 */
import { getCookie, getHeader, getRequestURL, setHeader } from 'h3'

/**
 * 伪静态详情页：SSR HTML 按 Cookie 定制 → 不允许被共享缓存（详见下方注释）
 * 与 nuxt.config.ts 的路由参数正则保持一致（id 只含字母数字与 _ -）。
 */
const DETAIL_PAGE_RE = /^\/(?:tokens|prompts)\/[A-Za-z0-9_-]+\.html$/i

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const path = getRequestURL(event).pathname

  // 跳过 API 与带文件扩展名的静态资源（页面路径无扩展名）
  if (path.startsWith('/api/')) return
  if (/\.(js|css|png|jpe?g|svg|ico|webp|gif|woff2?|ttf|otf|eot|txt|xml|json|map)$/i.test(path)) return

  // 尊重 routeRules 已标记 no-store 的路径（如 /login、/admin/**）：
  // 这些路径由显式配置决定禁用缓存，游客也不应升级为 public。
  // 注意：routeRules 的 header 在中间件执行阶段尚未写入 response，
  // 无法通过读取 Cache-Control 判断，故按路径前缀显式排除。
  if (path.startsWith('/admin') || path === '/login' || path === '/login/') return

  // 伪静态详情页（/tokens/<id>.html、/prompts/<id>.html）：**必须保持 private**。
  // 注意上面那行「带文件扩展名的静态资源」豁免正则不含 html，若不在这里显式拦下，
  // 这两个页面会被当成静态资源升级成 `public, s-maxage=120`，同时 Vary 被覆盖成
  // `Accept-Encoding, Origin` —— 丢掉 Vary:Cookie 后 CDN 会把某个访客的个性化
  // HTML 直接发给别人。这两个页面的 SSR HTML 恰恰是按 Cookie 定制的：
  // is_owner / can_edit / my_vote / my_review / edits（我的修改建议）/
  // guest_review（我的待审游客评测）/ 评测列表里的 my_marked。
  //
  // ⚠️ 以后任何「内容按 Cookie 定制」的 .html 路由，都必须加进这个白名单。
  if (DETAIL_PAGE_RE.test(path)) return

  // 已登录（cookie 或 Bearer）→ 保持 private，不缓存到共享层
  const authCookie = getCookie(event, 'favshub_token')
  const authHeader = getHeader(event, 'authorization')
  if (authCookie || (authHeader && authHeader.startsWith('Bearer '))) return

  // 游客 → 公开页面允许 CDN 缓存（CDN 上所有游客共享同一变体）
  setHeader(event, 'Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300')
  setHeader(event, 'Vary', 'Accept-Encoding, Origin')
})
