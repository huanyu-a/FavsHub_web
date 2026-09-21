/**
 * PUT /api/ai/token-deals/:id — 更新 Token 白嫖通告（write）
 * Body: { provider?, title?, url?, call_url?, quota?, models?, region?, quality?, source_tag?, expires_at?, note?, dry_run? }
 *
 * **部分更新语义**：只传需要修改的字段，未传字段保持原值。
 * 这与 Web 端 `PUT /api/token-deals/:id`（全量替换）不同，是为 AI 场景刻意放宽的 ——
 * 「把标题里的某段删掉」这类指令不应要求调用方回填全部字段。
 *
 * 权限：通告作者或管理员。他人资源一律返回 404（不区分「不存在」与「无权限」）。
 * 状态：管理员编辑保持原状态；作者编辑已审核通过的通告会回到 pending 重新审核。
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { updateTokenDeal } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return updateTokenDeal(getRawDb(), token.user_id, id, body)
})
