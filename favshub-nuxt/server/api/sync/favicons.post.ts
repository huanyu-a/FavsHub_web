/**
 * POST /api/sync/favicons — 上传 favicon base64 数据
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

export default defineEventHandler(async (event) => {
  const authUser = requireAuth(event)
  const body = await readBody(event)
  const { favicons } = body || {}

  if (!Array.isArray(favicons)) {
    throw createError({ statusCode: 400, data: { error: 'favicons 必须是数组' } })
  }

  const db = getRawDb()
  const userId = authUser.id

  const faviconDir = join(process.cwd(), 'public', 'images', 'favicons')
  if (!existsSync(faviconDir)) mkdirSync(faviconDir, { recursive: true })

  const updateStmt = db.prepare('UPDATE bookmarks SET icon = ? WHERE user_id = ? AND url = ?')
  let count = 0

  for (const item of favicons) {
    try {
      const hostname = new URL(item.url).hostname
      const filename = hostname + '.png'
      const filepath = join(faviconDir, filename)
      const localPath = `/images/favicons/${filename}`

      // 解码 base64 并写入文件
      const base64Data = item.base64.replace(/^data:image\/\w+;base64,/, '')
      writeFileSync(filepath, Buffer.from(base64Data, 'base64'))

      // 更新数据库（仅更新当前用户的图标，防止跨用户污染）
      updateStmt.run(localPath, userId, item.url)
      count++
    } catch (e: any) {
      console.warn('[favicon] 保存失败:', item.url, e.message)
    }
  }

  return { success: true, count }
})
