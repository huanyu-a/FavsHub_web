/**
 * POST /api/admin/download-favicon/:id — 单个书签 favicon 下载
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'
import { createError, getRouterParams } from 'h3'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'
import dns from 'node:dns'

function isPrivateIP(hostname: string): boolean {
  let h = hostname.toLowerCase()
  if (h.startsWith('::ffff:')) h = h.slice(7)
  const privateIPv4 = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.)/
  if (privateIPv4.test(h)) return true
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true
  return false
}

function downloadFavicon(url: string, destPath: string, _redirectDepth = 0): Promise<void> {
  const MAX_REDIRECTS = 3
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:') return reject(new Error('仅支持 HTTPS 协议'))
      if (isPrivateIP(u.hostname)) return reject(new Error('不允许访问内网地址'))

      const req = https.get(url, { timeout: 10000 }, (response) => {
        if (response.statusCode! >= 300 && response.statusCode! < 400 && response.headers.location) {
          if (_redirectDepth >= MAX_REDIRECTS) return reject(new Error('重定向次数超限'))
          const redirectUrl = response.headers.location.startsWith('http')
            ? response.headers.location
            : new URL(response.headers.location, u.origin).href
          const rUrl = new URL(redirectUrl)
          dns.lookup(rUrl.hostname, (err, address) => {
            if (err) return reject(new Error('DNS 解析失败: ' + err.message))
            if (isPrivateIP(address)) return reject(new Error('重定向目标为内网地址'))
            downloadFavicon(redirectUrl, destPath, _redirectDepth + 1).then(resolve).catch(reject)
          })
          return
        }
        if (response.statusCode !== 200) return reject(new Error('HTTP ' + response.statusCode))
        const file = createWriteStream(destPath)
        file.on('finish', () => { file.close(); resolve() })
        file.on('error', reject)
        response.pipe(file)
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    } catch (e) {
      reject(e)
    }
  })
}

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
    const localPath = `/images/favicons/${hostname}.png`
    const destPath = join(faviconDir, hostname + '.png')

    const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
    await downloadFavicon(faviconUrl, destPath)
    db.prepare('UPDATE bookmarks SET icon = ? WHERE id = ?').run(localPath, bookmark.id)
    return { success: true, icon: localPath }
  } catch (err: any) {
    throw createError({ statusCode: 500, data: { error: '下载失败: ' + err.message } })
  }
})
