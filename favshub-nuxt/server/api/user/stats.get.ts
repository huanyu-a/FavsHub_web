/**
 * GET /api/user/stats — 当前用户个人统计数据（仅自己的数据）
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  const bookmarks = (db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?').get(user.id) as any).count
  const folders = (db.prepare('SELECT COUNT(*) as count FROM folders WHERE user_id = ?').get(user.id) as any).count
  const prompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE user_id = ?').get(user.id) as any).count
  const promptFolders = (db.prepare('SELECT COUNT(*) as count FROM prompt_folders WHERE user_id = ?').get(user.id) as any).count
  const tags = (db.prepare('SELECT COUNT(DISTINCT t.id) as count FROM tags t JOIN prompt_tags pt ON t.id = pt.tag_id JOIN prompts p ON pt.prompt_id = p.id WHERE p.user_id = ?').get(user.id) as any).count
  const favoritePrompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE user_id = ? AND is_favorite = 1').get(user.id) as any).count
  const promptVersions = (db.prepare('SELECT COUNT(*) as count FROM prompt_versions WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').get(user.id) as any).count

  // 今日新增
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayTs = todayStart.getTime()
  const todayBookmarks = (db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ? AND created_at >= ?').get(user.id, todayTs) as any).count
  const todayPrompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE user_id = ? AND created_at >= ?').get(user.id, todayTs) as any).count

  return {
    bookmarks,
    folders,
    prompts,
    promptFolders,
    tags,
    favoritePrompts,
    promptVersions,
    todayBookmarks,
    todayPrompts,
  }
})
