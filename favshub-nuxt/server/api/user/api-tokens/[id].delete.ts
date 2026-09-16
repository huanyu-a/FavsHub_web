/**
 * DELETE /api/user/api-tokens/:id — 吊销 API 令牌（JWT 通道）
 *
 * 软吊销：置 revoked_at，保留记录以便审计追溯（`ai_audit_logs` 外键仍可关联）。
 * 仅令牌所有者可吊销自己的令牌。
 */
import { getRouterParams } from 'h3'
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler((event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const tokenId = Number(id)
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    throw createError({ statusCode: 400, message: '令牌 ID 非法', data: { error: '令牌 ID 非法' } })
  }

  const db = getRawDb()
  // 强制归属过滤：非本人令牌 → 404（不区分「不存在」与「无权限」）
  const row = db.prepare('SELECT id, name, revoked_at FROM api_tokens WHERE id = ? AND user_id = ?').get(tokenId, user.id) as any
  if (!row) {
    throw createError({ statusCode: 404, message: '令牌不存在', data: { error: '令牌不存在' } })
  }
  if (row.revoked_at) {
    return { success: true, already_revoked: true, revoked: { id: row.id, name: row.name } }
  }

  db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?').run(Date.now(), tokenId, user.id)

  return { success: true, revoked: { id: row.id, name: row.name } }
})
