/**
 * DELETE /api/admin/prompt-folders/:id — 删除提示词文件夹
 * 管理员：可删除任意文件夹
 * 普通用户：仅可删除自己的文件夹
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '无效的文件夹 ID' } })
  }

  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '提示词文件夹不存在' } })
  }

  if (!isAdmin && folder.user_id !== auth.id) {
    throw createError({ statusCode: 403, data: { error: '无权限删除此文件夹' } })
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE prompts SET folder_id = NULL WHERE folder_id = ?').run(id)
    db.prepare('DELETE FROM prompt_folders WHERE id = ?').run(id)
  })
  tx()

  return { success: true, message: '已删除提示词文件夹' }
})
