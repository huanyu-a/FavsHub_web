/**
 * POST /api/token-keys/:id/vote — 「福利 Key」可用性投票（还能用 / 不可用）
 * Body: { vote: 'up' | 'down' }
 *
 * 对照白嫖通告的 POST /api/token-deals/:id/vote：**无需登录**，一人一票，
 * 重复投同一方向视为取消，投相反方向视为改票；身份统一走指纹（登录用户
 * fp:u<id> / 游客 cookie+UA），游客另有「同 IP 同 key 最多计入 3 票」上限。
 *
 * 可见性与列表同口径（published + 非 dead + 指引 24h 内），不可见一律 404。
 * 鉴权：无；限频（每身份 120 次/小时）在服务层。实现全部在 key-votes.ts，
 * 本文件只做薄端点包装（同 token-deals/[id]/vote.post.ts 模式）。
 *
 * 缓存：POST 不入任何缓存；routeRules 的 '/api/token-keys' 公开缓存规则
 * （public, max-age=300）按前缀命中本路径，这里显式 no-store 覆盖，
 * 与 copy.get.ts 显式声明作为安全契约的做法一致。
 */
import { getRawDb } from '../../../database'
import { toggleKeyVote } from '../../../utils/key-votes'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, private')

  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))

  const result = toggleKeyVote(getRawDb(), event, id, body?.vote)
  if (!result.ok) {
    throw createError({ statusCode: result.status, data: { error: result.error } })
  }

  return { success: true, ...result.data }
})