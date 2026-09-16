/**
 * POST /api/user/api-tokens — 创建 API 令牌（JWT 通道）
 *
 * Body: { name, scopes: ['read','write'] | 'read,write', expires_in_days?: number }
 *
 * 安全约束：
 *   - 明文令牌**仅在本响应中返回一次**，库中只存 SHA-256 哈希。
 *   - `delete` scope 需管理员身份；普通用户请求将返回 403。
 *   - 每个用户最多保留 20 个未吊销令牌，防止无限创建。
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { generatePat, hashPat, patPrefixOf, parseScopes, serializeScopes, formatPatPrefix } from '../../../utils/ai-auth'

const MAX_TOKENS_PER_USER = 20
const MAX_NAME_LEN = 64

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, message: '未登录', data: { error: '未登录' } })
  }
  const { user, isAdmin } = role

  const body = await readBody(event)
  const name = String(body?.name ?? '').trim()
  if (!name) {
    throw createError({ statusCode: 400, message: '令牌名称不能为空', data: { error: '令牌名称不能为空' } })
  }
  if (name.length > MAX_NAME_LEN) {
    throw createError({ statusCode: 400, message: `令牌名称最长 ${MAX_NAME_LEN} 字符`, data: { error: `令牌名称最长 ${MAX_NAME_LEN} 字符` } })
  }

  const scopes = parseScopes(body?.scopes)
  if (scopes.length === 0) {
    throw createError({ statusCode: 400, message: '至少需要一个 scope（read / write / delete）', data: { error: '至少需要一个 scope（read / write / delete）' } })
  }
  if (scopes.includes('delete') && !isAdmin) {
    throw createError({
      statusCode: 403,
      message: '仅管理员可创建含 delete 权限的令牌',
      data: { error: '仅管理员可创建含 delete（删除）权限的令牌' },
    })
  }

  // 过期时间：默认永久；显式传天数时换算
  let expiresAt: number | null = null
  const days = Number(body?.expires_in_days)
  if (body?.expires_in_days !== undefined && body?.expires_in_days !== null && body?.expires_in_days !== '') {
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      throw createError({ statusCode: 400, message: '有效天数非法（1–3650）', data: { error: '有效天数非法（1–3650）' } })
    }
    expiresAt = Date.now() + Math.floor(days) * 24 * 60 * 60 * 1000
  }

  const db = getRawDb()
  const active = (db.prepare(
    'SELECT COUNT(*) AS c FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL'
  ).get(user.id) as { c: number }).c
  if (active >= MAX_TOKENS_PER_USER) {
    throw createError({
      statusCode: 400,
      message: `最多保留 ${MAX_TOKENS_PER_USER} 个有效令牌，请先吊销不再使用的令牌`,
      data: { error: `最多保留 ${MAX_TOKENS_PER_USER} 个有效令牌，请先吊销不再使用的令牌` },
    })
  }

  const plain = generatePat()
  const now = Date.now()

  const result = db.prepare(
    `INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, scopes, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(user.id, name, hashPat(plain), patPrefixOf(plain), serializeScopes(scopes), now, expiresAt)

  return {
    // ⚠️ 明文令牌仅此一次返回，请立即保存到安全位置
    token: plain,
    token_info: {
      id: Number(result.lastInsertRowid),
      name,
      prefix: formatPatPrefix(patPrefixOf(plain)),
      scopes: serializeScopes(scopes).split(','),
      created_at: now,
      expires_at: expiresAt,
      status: 'active',
    },
    warning: '明文令牌仅显示一次，请立即复制保存。站点不保存明文，遗失后只能重新创建。',
  }
})
