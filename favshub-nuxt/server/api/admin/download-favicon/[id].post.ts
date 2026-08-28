/**
 * POST /api/admin/download-favicon/:id — 单个书签 favicon 下载
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { getConfig } from '../../../utils/config'
import { downloadFavicon } from '../../../utils/favicon-download'
import { createError, getRouterParams } from 'h3'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const bookmarkId = parseInt(id)
  if (isNaN(bookmarkId)) {
    throw createError({ statusCode: 400, data: { error: '无效的书签 ID' } })
  }

  const bookmark = db.prepare('SELECT id, url FROM bookmarks WHERE id = ?').get(bookmarkId) as any
  if (!bookmark) {
    throw createError({ statusCode: 404, data: { error: '书签不存在' } })
  }

  const faviconDir = join(process.cwd(), 'public', 'images', 'favicons')
  if (!existsSync(faviconDir)) mkdirSync(faviconDir, { recursive: true })

  try {
    const hostname = new URL(bookmark.url).hostname
    // 净化 hostname：仅允许合法 DNS 字符，防止路径穿越
    const safeHostname = hostname.replace(/[^a-zA-Z0-9.-]/g, '')
    if (!safeHostname || safeHostname.includes('..')) {
      throw createError({ statusCode: 400, data: { error: '无效的书签域名' } })
    }
    const localPath = `/images/favicons/${safeHostname}.png`
    const destPath = join(faviconDir, safeHostname + '.png')

    const sourceUrl = getConfig('favicon_source_url') || 'https://www.google.com/s2/favicons?domain={domain}&sz={size}'
    const sz = getConfig('favicon_size') || '32'
    const faviconUrl = sourceUrl.replace('{domain}', hostname).replace('{size}', sz)
    await downloadFavicon(faviconUrl, destPath)
    db.prepare('UPDATE bookmarks SET icon = ? WHERE id = ?').run(localPath, bookmark.id)
    return { success: true, icon: localPath }
  } catch (err: any) {
    throw createError({ statusCode: 500, data: { error: '下载失败: ' + err.message } })
  }
})
