/**
 * POST /api/admin/retry-failed-favicons — 重试失败的 favicon 下载
 * 将 Google favicon 远程 URL 替换为本地路径
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'
import { getConfig, getConfigInt } from '../../utils/config'
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
  const MAX_REDIRECTS = getConfigInt('favicon_max_redirects', 3)
  const timeout = getConfigInt('favicon_download_timeout', 10000)
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:') return reject(new Error('仅支持 HTTPS 协议'))
      if (isPrivateIP(u.hostname)) return reject(new Error('不允许访问内网地址'))

      const req = https.get(url, { timeout }, (response) => {
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

  const faviconDir = join(process.cwd(), 'public', 'images', 'favicons')
  if (!existsSync(faviconDir)) mkdirSync(faviconDir, { recursive: true })

  const bookmarks = db.prepare(`
    SELECT id, url, icon FROM bookmarks
    WHERE icon LIKE '%google.com/s2/favicons%' OR icon LIKE '%favicon%'
  `).all() as any[]

  if (!bookmarks.length) {
    return { success: true, message: '没有需要重试的图标', count: 0 }
  }

  // 按 hostname 分组
  const hostGroups: Record<string, number[]> = {}
  for (const bm of bookmarks) {
    try {
      const hostname = new URL(bm.url).hostname
      if (!hostGroups[hostname]) hostGroups[hostname] = []
      hostGroups[hostname].push(bm.id)
    } catch { /* 无效 URL 跳过 */ }
  }

  const hostnames = Object.keys(hostGroups)
  let errors = 0
  const updateByHostname = db.prepare("UPDATE bookmarks SET icon = ? WHERE url LIKE ?")

  for (const hostname of hostnames) {
    const localPath = `/images/favicons/${hostname}.png`
    const destPath = join(faviconDir, hostname + '.png')

    if (existsSync(destPath)) {
      updateByHostname.run(localPath, `%://${hostname}/%`)
      continue
    }

    const sourceUrl = getConfig('favicon_source_url') || 'https://www.google.com/s2/favicons?domain={domain}&sz={size}'
    const sz = getConfig('favicon_size') || '32'
    const faviconUrl = sourceUrl.replace('{domain}', hostname).replace('{size}', sz)
    try {
      await downloadFavicon(faviconUrl, destPath)
      updateByHostname.run(localPath, `%://${hostname}/%`)
    } catch {
      errors++
    }
  }

  return {
    success: true,
    message: '重试完成',
    domains: hostnames.length,
    bookmarks: bookmarks.length,
    errors
  }
})
