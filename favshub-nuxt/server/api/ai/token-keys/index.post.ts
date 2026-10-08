/**
 * POST /api/ai/token-keys — 上报「福利 Key」凭证（write，docs/08 §4.3）
 * Body: { key_hash, base_url?, key_masked?, key_encrypted?, provider?, models?, source?,
 *         confidence?, verdict?, source_id?, source_tid?, source_url?, source_title?,
 *         source_author?, consecutive_failures?, last_probe_at?, first_seen_at?, note?, dry_run? }
 *
 * 校验 / dry_run / 按 (key_hash, base_url) upsert / 普通 PAT→pending、管理员 PAT→published
 * 全部由 upsertTokenKey（ai-service.ts）实现，本文件只做薄端点包装（同 ai/token-deals/index.post.ts 模式）。
 * 鉴权（favs_ai_ PAT）与限频（IP 兜底 300/min + 令牌 600/min）由 defineAiHandler 继承，绝不回退 JWT。
 *
 * 时间戳纪律：token_keys 沿爬虫语义存「秒」，与其余表（token_deals 等）的毫秒不同，页面渲染时 ×1000。
 * 红线：明文 key / key_hash / key_encrypted 绝不出现在任何日志或响应。
 */
import { readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { upsertTokenKey } from '../../../utils/ai-service'

export default defineAiHandler('write', async (event, token) => {
  const body = await readBody(event).catch(() => ({}))
  return upsertTokenKey(getRawDb(), token.user_id, body)
})
