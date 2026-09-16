/**
 * GET /api/ai/stats — 资源计数盘点（read）
 *
 * 轻量概览，供 AI 快速了解当前账号的数据规模，避免全量拉取。
 */
import { getRawDb } from '../../database'
import { defineAiHandler } from '../../utils/ai-auth'

export default defineAiHandler('read', async (_event, token) => {
  const db = getRawDb()
  const uid = token.user_id
  const one = (sql: string, ...args: any[]) => (db.prepare(sql).get(...args) as any).c as number

  return {
    user_id: uid,
    counts: {
      bookmarks: one('SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = ?', uid),
      bookmarks_public_pool: one("SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = ? AND label = ''", uid),
      folders: one('SELECT COUNT(*) AS c FROM folders WHERE user_id = ?', uid),
      prompts: one('SELECT COUNT(*) AS c FROM prompts WHERE user_id = ? AND deleted_at IS NULL', uid),
      prompts_trashed: one('SELECT COUNT(*) AS c FROM prompts WHERE user_id = ? AND deleted_at IS NOT NULL', uid),
      prompt_folders: one('SELECT COUNT(*) AS c FROM prompt_folders WHERE user_id = ?', uid),
      tags: one('SELECT COUNT(*) AS c FROM tags WHERE user_id = ?', uid),
      token_deals: one('SELECT COUNT(*) AS c FROM token_deals WHERE user_id = ?', uid),
      token_deals_pending: one("SELECT COUNT(*) AS c FROM token_deals WHERE user_id = ? AND status = 'pending'", uid),
    },
    recent: {
      bookmarks: db.prepare('SELECT id, title, url, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(uid),
      prompts: db.prepare('SELECT id, title, updated_at FROM prompts WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5').all(uid),
    },
    token: {
      id: token.id,
      name: token.name,
      scopes: token.scopes,
      last_used_at: token.last_used_at,
      expires_at: token.expires_at,
    },
  }
})
