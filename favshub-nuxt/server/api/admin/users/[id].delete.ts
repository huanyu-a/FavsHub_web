/**
 * DELETE /api/admin/users/:id — 删除用户及其所有数据
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const userId = parseInt(id)
  if (isNaN(userId)) {
    throw createError({ statusCode: 400, data: { error: '无效的用户 ID' } })
  }

  if (userId === 0) {
    throw createError({ statusCode: 400, data: { error: '不能删除系统用户' } })
  }

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any
  if (!user) {
    throw createError({ statusCode: 404, data: { error: '用户不存在' } })
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(userId)
    db.prepare('UPDATE folders SET parent_id = NULL WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM folders WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId)
    db.prepare('DELETE FROM prompt_versions WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId)
    db.prepare('DELETE FROM prompts WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM prompt_folders WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM tags WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM collection_bookmarks WHERE collection_id IN (SELECT id FROM collections WHERE user_id = ?)').run(userId)
    db.prepare('DELETE FROM collections WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  })
  tx()

  return { success: true, message: `已删除用户 ${user.username} 及其所有数据` }
})
