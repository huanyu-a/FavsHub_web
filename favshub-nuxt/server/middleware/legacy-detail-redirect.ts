/**
 * 旧详情地址 301 —— 伪静态改造的向后兼容层
 *
 * 详情页地址从「查询参数」形态改为「路径 + .html」形态：
 *   /tokens?deal=<dealId>        → 301 → /tokens/<dealId>.html
 *   /prompts?prompt_id=<promptId> → 301 → /prompts/<promptId>.html
 *
 * 为什么放在服务端而不是页面里 router.replace：
 *   对外分享过的链接、二维码、QQ 通知、老搜索结果与爬虫索引拿到的都是旧地址。
 *   客户端跳转对爬虫不可见（拿到的是 200 + 空壳 HTML），只有在服务端返回 301
 *   才能让浏览器与爬虫都把收录/权重迁到新地址，也才能保证老链接仍然可用。
 *
 * 行为约定：
 *   - 只匹配这两个列表路径（含尾斜杠），其余路径不动；
 *   - 除 deal / prompt_id 之外的查询参数原样带到新地址（例如 /tokens?action=publish）；
 *   - id 形状不合法（含 . / % / 空白等）时不重定向，交给列表页正常渲染 ——
 *     否则会 301 到一个必然 404 的地址，比留在列表页更糟。
 */
import { getRequestURL, sendRedirect } from 'h3'

/** 允许出现在路径里的 id 形状：与 nuxt.config.ts 里路由参数的正则保持一致 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const url = getRequestURL(event)
  const path = url.pathname

  const isTokens = path === '/tokens' || path === '/tokens/'
  const isPrompts = path === '/prompts' || path === '/prompts/'
  if (!isTokens && !isPrompts) return

  const param = isTokens ? 'deal' : 'prompt_id'
  const id = String(url.searchParams.get(param) || '').trim()
  if (!id || !SAFE_ID.test(id)) return

  const rest = new URLSearchParams(url.searchParams)
  rest.delete(param)
  const qs = rest.toString()

  const target = `${isTokens ? '/tokens' : '/prompts'}/${encodeURIComponent(id)}.html${qs ? `?${qs}` : ''}`
  return sendRedirect(event, target, 301)
})
