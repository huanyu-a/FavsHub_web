/**
 * GET /api/admin/stats — 系统统计数据
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const users = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count
  const bookmarks = (db.prepare('SELECT COUNT(*) as count FROM bookmarks').get() as any).count
  const folders = (db.prepare('SELECT COUNT(*) as count FROM folders').get() as any).count
  const prompts = (db.prepare('SELECT COUNT(*) as count FROM prompts').get() as any).count
  const tags = (db.prepare('SELECT COUNT(*) as count FROM tags').get() as any).count
  const promptFolders = (db.prepare('SELECT COUNT(*) as count FROM prompt_folders').get() as any).count
  const promptVersions = (db.prepare('SELECT COUNT(*) as count FROM prompt_versions').get() as any).count
  const searchEngines = (db.prepare('SELECT COUNT(*) as count FROM search_engines').get() as any).count
  const adminUsers = (db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get() as any).count
  const favoritePrompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE is_favorite = 1').get() as any).count

  // 今日新增（基于毫秒时间戳）
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayTs = todayStart.getTime()
  const todayBookmarks = (db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE created_at >= ?').get(todayTs) as any).count
  const todayPrompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE created_at >= ?').get(todayTs) as any).count

  // 数据库大小
  let dbSize = 0
  try {
    const config = useRuntimeConfig(event)
    const dbPath = config.dbPath || join(process.cwd(), 'data', 'favshub.db')
    if (existsSync(dbPath)) {
      dbSize = statSync(dbPath).size
    }
  } catch { /* ignore */ }

  return {
    users,
    bookmarks,
    folders,
    prompts,
    tags,
    promptFolders,
    promptVersions,
    searchEngines,
    adminUsers,
    favoritePrompts,
    todayBookmarks,
    todayPrompts,
    dbSize
  }
})
