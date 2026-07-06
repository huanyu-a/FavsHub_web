/**
 * GET /api/admin/stats — 统计数据
 * 管理员：返回全局系统统计
 * 普通用户：返回个人数据统计
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

  // 今日起始时间戳
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayTs = todayStart.getTime()

	if (!isAdmin) {
	    // ── 普通用户：自己的 + 管理员公开数据 ────────────────────
	    const bookmarks = (db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ? OR login_required = 0').get(user.id) as any).count
	    const folders = (db.prepare('SELECT COUNT(*) as count FROM folders WHERE user_id = ? OR login_required = 0').get(user.id) as any).count
	    const prompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE user_id = ? OR login_required = 0').get(user.id) as any).count
	    const promptFolders = (db.prepare('SELECT COUNT(*) as count FROM prompt_folders WHERE user_id = ? OR user_id IN (SELECT id FROM users WHERE is_admin = 1)').get(user.id) as any).count
	    const tags = (db.prepare('SELECT COUNT(DISTINCT tag_id) as count FROM prompt_tags pt JOIN prompts p ON pt.prompt_id = p.id WHERE p.user_id = ? OR p.login_required = 0').get(user.id) as any).count
	    const favoritePrompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE is_favorite = 1 AND (user_id = ? OR login_required = 0)').get(user.id) as any).count
	    const promptVersions = (db.prepare('SELECT COUNT(*) as count FROM prompt_versions pv JOIN prompts p ON pv.prompt_id = p.id WHERE p.user_id = ? OR p.login_required = 0').get(user.id) as any).count
	    const todayBookmarks = (db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE created_at >= ? AND (user_id = ? OR login_required = 0)').get(todayTs, user.id) as any).count
	    const todayPrompts = (db.prepare('SELECT COUNT(*) as count FROM prompts WHERE created_at >= ? AND (user_id = ? OR login_required = 0)').get(todayTs, user.id) as any).count

    return {
      scope: 'personal',
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
  }

  // ── 管理员：全局统计 ────────────────────────────────────────
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

  const dbSizeFormatted = dbSize > 1024 * 1024
    ? (dbSize / 1024 / 1024).toFixed(2) + ' MB'
    : (dbSize / 1024).toFixed(1) + ' KB'

  return {
    scope: 'global',
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
    dbSize: dbSizeFormatted,
  }
})
