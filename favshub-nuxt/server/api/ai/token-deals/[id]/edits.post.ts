/**
 * POST /api/ai/token-deals/:id/edits — 提交通告修改建议（write）
 *
 * Body: { <可改字段...>, comment?, dry_run? }
 *
 * 站点规则：**通告内容允许所有人修改，但需经「通告作者」或「管理员」审核。**
 * 任何登录用户都可对**已公开**的通告提交字段级修改建议（只传要改的字段）；
 * 同一人对同一通告只保留一条待审建议，再次提交即覆盖。
 * 建议通过前通告内容不受影响。
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../../database'
import { defineAiHandler } from '../../../../utils/ai-auth'
import { submitTokenDealEdit } from '../../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return submitTokenDealEdit(getRawDb(), token.user_id, id, body)
})
