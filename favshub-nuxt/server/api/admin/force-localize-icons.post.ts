/**
 * POST /api/admin/force-localize-icons — 强制本地化图标路径
 * 将 Google favicon 远程 URL 替换为本地路径（不下载，仅更新 DB 记录）
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const bookmarks = db.prepare(`
    SELECT id, url, icon FROM bookmarks
    WHERE icon LIKE '%google.com/s2/favicons%' OR icon LIKE '%favicon%'
  `).all() as any[]

  if (!bookmarks.length) {
    return { success: true, message: '没有需要本地化的图标', count: 0 }
  }

  const updateStmt = db.prepare('UPDATE bookmarks SET icon = ? WHERE id = ?')
  let updated = 0

  for (const bm of bookmarks) {
    try {
      const hostname = new URL(bm.url).hostname
      const localPath = `/images/favicons/${hostname}.png`
      updateStmt.run(localPath, bm.id)
      updated++
    } catch { /* 无效 URL 跳过 */ }
  }

  return { success: true, message: `已更新 ${updated} 个书签的图标路径`, count: updated }
})
