/**
 * POST /api/ai/token-keys/prune — 福利 Key 对账清理（delete scope，2026-10-08）
 * Body: { confirm: true, keep: [{ key_hash, base_url }, ...] }
 *
 * 爬虫每轮全量快照上报完成后调用：站点上 `published` 但不在 keep 身份列表里的
 * 行被删除（dead / 下架 / 过期 guide 行自动消失）。hidden / pending 永不删。
 *
 * 鉴权：`delete` scope（AI 通道纪律 —— 删除必须显式授予的 delete 令牌，且仅管理员）
 * + 服务端 isUserAdmin 再判一次。限频与审计由 defineAiHandler 继承。
 * 实现全部在 pruneTokenKeys（ai-service.ts），本文件只做薄端点包装。
 */
import { readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { pruneTokenKeys } from '../../../utils/ai-service'

export default defineAiHandler('delete', async (event, token) => {
  const body = await readBody(event).catch(() => ({}))
  if (body?.confirm !== true) {
    throw createError({ statusCode: 400, data: { error: '删除操作必须携带 confirm: true' } })
  }
  const keep = Array.isArray(body?.keep) ? body.keep : []
  return pruneTokenKeys(getRawDb(), token.user_id, keep)
})
