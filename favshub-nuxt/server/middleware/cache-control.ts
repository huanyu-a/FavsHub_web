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
 * 归一化请求路径 —— 缓存判定**必须**在归一化之后做。
 *
 * 为什么：同一张页面有多种等价写法（尾斜杠 `/x.html/`、结尾 `/.`、以及百分号编码
 * `%2Ehtml` / `deal%5Fbyp` / `%64eal`），而 vue-router 是**先解码再匹配**路由参数的。
 * 2026-10-30 复核实测：按未解码原串做精确正则匹配时，有 **5 种写法**能绕过豁免、
 * 掉进下面「游客 → public」的分支，于是按 Cookie 定制的个性化详情页被判为可共享缓存 ——
 * CDN 会把某个访客的个性化 HTML 发给别人。归一化后再判，这些写法一律收敛到同一形态。
 */
function normalizePath(path: string): string {
  let p = path
  try {
    p = decodeURIComponent(p)
  } catch {
    // 解码失败（非法编码）时用原串：这类路径由 Nitro 直接 400，不必为它做特殊处理
  }
  return p
    .replace(/\/{2,}/g, '/')        // 折叠重复斜杠
    .replace(/(?:\/\.)+\/?$/, '/')  // 去掉结尾的 /. 与 /..
    .replace(/\/+$/, '')            // 去掉尾斜杠
}

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const path = normalizePath(getRequestURL(event).pathname)

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
  // 判定用**后缀规则**而不是枚举具体路由：只要归一化后以 `.html` 结尾就保持 private。
  // 站点的公开列表页都是无扩展名的（`/`、`/tokens`、`/prompts`、`/collections`、
  // `/tokens/keys` —— 复核用「两个不同 visitor cookie 差分」实测确认这些页面无个性化），
  // 所以这条规则不会误伤公开页；而**以后任何人新增一个 .html 页面，都自动继承
  // 「不被共享缓存」这个安全默认**，不需要记得回来加白名单 —— 枚举式白名单的失效方式
  // 恰恰是「新页面忘了加」，2026-10-30 的 5 种绕过写法就是这么出现的。
  if (/\.html$/i.test(path)) return

  // 已登录（cookie 或 Bearer）→ 保持 private，不缓存到共享层
  const authCookie = getCookie(event, 'favshub_token')
  const authHeader = getHeader(event, 'authorization')
  if (authCookie || (authHeader && authHeader.startsWith('Bearer '))) return

  // 游客 → 公开页面允许 CDN 缓存（CDN 上所有游客共享同一变体）
  setHeader(event, 'Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300')
  setHeader(event, 'Vary', 'Accept-Encoding, Origin')
})
