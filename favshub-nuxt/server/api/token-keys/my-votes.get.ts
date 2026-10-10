/**
 * GET /api/token-keys/my-votes — 当前访客在指定 key 上的投票方向（批量）
 * Query: ids=逗号分隔 key id（上限 50）
 *
 * 列表接口（GET /api/token-keys）为 CDN 公开缓存且与登录态零相关，不含
 * my_vote；卡片高亮（我的投票）由前端挂载后到这里批量补拉 —— 与
 * copy.get.ts 的按需下发同款思路，避免 per-user 数据污染共享缓存。
 *
 * 鉴权：无（登录用户按 fp:u<id> 指纹，游客按 cookie+UA 指纹，同投票端点口径）。
 * 缓存：显式 no-store（per-user 数据，routeRules 的公开缓存规则按前缀命中
 * 本路径，必须覆盖）；id 全部经格式校验，非法值忽略。
 */
import { getRawDb } from '../../database'
import { optionalAuthLoose } from '../../utils/guest-reviews'
import { myVotesForKeys } from '../../utils/key-votes'

export default defineEventHandler((event) => {
  // per-user 数据绝不入任何缓存（浏览器 / CDN / Nitro route cache 一律绕过）
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, private')
  setHeader(event, 'Vary', 'Cookie')

  const query = getQuery(event)
  const raw = String(query.ids || '')
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => /^[\w-]{1,80}$/.test(s)))]
    .slice(0, 50)

  if (!ids.length) return { votes: {} }

  // 身份口径必须与 POST vote 完全一致：登录用户 fp:u<id>，游客 cookie+UA
  const viewer = optionalAuthLoose(event)
  return { votes: myVotesForKeys(getRawDb(), event, ids, viewer?.id ?? null) }
})