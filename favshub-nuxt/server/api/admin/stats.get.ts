/**
 * GET /api/admin/stats — 统计数据
 * 管理员：系统信息 + 个人数据
 * 普通用户：仅个人数据
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const db = getRawDb()
  const { user, isAdmin } = authRole

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayTs = todayStart.getTime()

  // 所有人：个人数据统计（单次查询合并 9 个 COUNT）
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?) as bookmarks,
      (SELECT COUNT(*) FROM folders WHERE user_id = ?) as folders,
      (SELECT COUNT(*) FROM prompts WHERE user_id = ?) as prompts,
      (SELECT COUNT(*) FROM prompt_folders WHERE user_id = ?) as promptFolders,
      (SELECT COUNT(DISTINCT tag_id) FROM prompt_tags pt JOIN prompts p ON pt.prompt_id = p.id WHERE p.user_id = ?) as tags,
      (SELECT COUNT(*) FROM prompts WHERE user_id = ? AND is_favorite = 1) as favoritePrompts,
      (SELECT COUNT(*) FROM prompt_versions pv JOIN prompts p ON pv.prompt_id = p.id WHERE p.user_id = ?) as promptVersions,
      (SELECT COUNT(*) FROM bookmarks WHERE user_id = ? AND created_at >= ?) as todayBookmarks,
      (SELECT COUNT(*) FROM prompts WHERE user_id = ? AND created_at >= ?) as todayPrompts
  `).get(user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, todayTs, user.id, todayTs) as any

  const result: Record<string, any> = {
    bookmarks: stats.bookmarks,
    folders: stats.folders,
    prompts: stats.prompts,
    promptFolders: stats.promptFolders,
    tags: stats.tags,
    favoritePrompts: stats.favoritePrompts,
    promptVersions: stats.promptVersions,
    todayBookmarks: stats.todayBookmarks,
    todayPrompts: stats.todayPrompts,
  }

  // 管理员额外：系统信息（不含其他用户的详细内容）
  if (isAdmin) {
    // 数据库大小
    let dbSize = 0
    try {
      const config = useRuntimeConfig(event)
      const dbPath = config.dbPath || join(process.cwd(), 'data', 'favshub.db')
      if (existsSync(dbPath)) {
        dbSize = statSync(dbPath).size
      }
    } catch { /* ignore */ }

    // 管理员系统统计（合并为单次查询）
    const sysStats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM search_engines) as searchEngines,
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM users WHERE is_admin = 1) as adminUsers
    `).get() as any
    result.searchEngines = sysStats.searchEngines
    result.users = sysStats.users
    result.adminUsers = sysStats.adminUsers
    result.dbSize = dbSize > 1024 * 1024
      ? (dbSize / 1024 / 1024).toFixed(2) + ' MB'
      : (dbSize / 1024).toFixed(1) + ' KB'
  }

  return result
})
