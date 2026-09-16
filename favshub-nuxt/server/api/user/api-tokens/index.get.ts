/**
 * GET /api/user/api-tokens — 列出当前用户的 API 令牌（JWT 通道）
 *
 * 安全：**绝不返回 token_hash**；只返回可安全展示的元信息。
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { formatPatPrefix } from '../../../utils/ai-auth'

export default defineEventHandler((event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  const rows = db.prepare(
    `SELECT id, name, token_prefix, scopes, created_at, expires_at, last_used_at, revoked_at
       FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`
  ).all(user.id) as any[]

  const now = Date.now()
  const tokens = rows.map(r => ({
    id: r.id,
    name: r.name,
    prefix: formatPatPrefix(r.token_prefix),
    scopes: String(r.scopes || '').split(',').filter(Boolean),
    created_at: r.created_at,
    expires_at: r.expires_at,
    last_used_at: r.last_used_at,
    revoked_at: r.revoked_at,
    status: r.revoked_at ? 'revoked' : (r.expires_at && r.expires_at < now ? 'expired' : 'active'),
  }))

  return { tokens, count: tokens.length }
})
