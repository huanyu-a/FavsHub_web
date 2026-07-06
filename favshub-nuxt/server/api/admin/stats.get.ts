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
  const auth = getAuthRole(event)
  if (!auth) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }

  const db = getRawDb()
  const { user, isAdmin } = auth

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayTs = todayStart.getTime()

  // 所有人：个人数据统计
  const bookmarks = (db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?').get(user.id) as any).count
  const folders = (db.prepare('SELECT COUNT(*) as count FROM folders WHERE user_id = ?').get(user.id) as any).count
  const prompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE user_id = ?').get(user.id) as any).count
  const promptFolders = (db.prepare('SELECT COUNT(*) as count FROM prompt_folders WHERE user_id = ?').get(user.id) as any).count
  const tags = (db.prepare('SELECT COUNT(DISTINCT tag_id) as count FROM prompt_tags pt JOIN prompts p ON pt.prompt_id = p.id WHERE p.user_id = ?').get(user.id) as any).count
  const favoritePrompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE user_id = ? AND is_favorite = 1').get(user.id) as any).count
  const promptVersions = (db.prepare('SELECT COUNT(*) as count FROM prompt_versions pv JOIN prompts p ON pv.prompt_id = p.id WHERE p.user_id = ?').get(user.id) as any).count
  const todayBookmarks = (db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ? AND created_at >= ?').get(user.id, todayTs) as any).count
  const todayPrompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE user_id = ? AND created_at >= ?').get(user.id, todayTs) as any).count

  const result: Record<string, any> = {
    bookmarks, folders, prompts, promptFolders, tags,
    favoritePrompts, promptVersions, todayBookmarks, todayPrompts,
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

    result.searchEngines = (db.prepare('SELECT COUNT(*) as count FROM search_engines').get() as any).count
    result.dbSize = dbSize > 1024 * 1024
      ? (dbSize / 1024 / 1024).toFixed(2) + ' MB'
      : (dbSize / 1024).toFixed(1) + ' KB'
    result.users = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count
    result.adminUsers = (db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get() as any).count
  }

  return result
})
