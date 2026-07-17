/**
 * POST /api/admin/dev/clear-prompts — 清空当前用户的所有提示词数据
 * 仅管理员可用，用于重置测试环境
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const db = getRawDb()

  const promptIds = db.prepare('SELECT id FROM prompts WHERE user_id = ?').all(user.id) as { id: string }[]

  const deleteRelations = db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?')
  const deleteVersions = db.prepare('DELETE FROM prompt_versions WHERE prompt_id = ?')
  const deletePrompts = db.prepare('DELETE FROM prompts WHERE id = ?')
  const deleteOrphanTags = db.prepare('DELETE FROM tags WHERE user_id = ? AND id NOT IN (SELECT DISTINCT tag_id FROM prompt_tags)')
  const deleteFolders = db.prepare('DELETE FROM prompt_folders WHERE user_id = ?')

  const tx = db.transaction(() => {
    for (const { id } of promptIds) {
      deleteRelations.run(id)
      deleteVersions.run(id)
      deletePrompts.run(id)
    }
    deleteOrphanTags.run(user.id)
    deleteFolders.run(user.id)
  })

  tx()

  return { success: true, deleted: promptIds.length }
})
