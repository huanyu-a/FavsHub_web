/**
 * POST /api/sync/favicons — 上传 favicon base64 数据
 *
 * 优先从配置的 favicon 源下载真实图标，
 * 仅在下载失败时使用浏览器缓存的 base64 数据。
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { getFaviconDir } from '../../utils/favicon-dir'
import { isRasterIcon } from '../../utils/favicon-download'
import { getConfig } from '../../utils/config'

function getSourceUrl(): string {
  return getConfig('favicon_source_url') || 'https://favicon.im/{domain}'
}

export default defineEventHandler(async (event) => {
  const authUser = requireAuth(event)
  const body = await readBody(event)
  const { favicons } = body || {}

  if (!Array.isArray(favicons)) {
    throw createError({ statusCode: 400, data: { error: 'favicons 必须是数组' } })
  }

  if (favicons.length > 1000) {
    throw createError({ statusCode: 400, data: { error: '最多 1000 个图标' } })
  }

  const db = getRawDb()
  const userId = authUser.id

  const faviconDir = getFaviconDir()
  if (!existsSync(faviconDir)) mkdirSync(faviconDir, { recursive: true })

  // 按域名去重，同一域名只下载一次
  const updateByHostname = db.prepare(
    `UPDATE bookmarks SET icon = ? WHERE user_id = ? AND url LIKE ? ESCAPE '\\'`
  )
  const seenHostnames = new Set<string>()
  let count = 0

  for (const item of favicons) {
    try {
      const hostname = new URL(item.url).hostname
      if (seenHostnames.has(hostname)) continue
      seenHostnames.add(hostname)

      // 净化 hostname：仅允许合法 DNS 字符（字母、数字、连字符、点），防止路径穿越
      const safeHostname = hostname.replace(/[^a-zA-Z0-9.-]/g, '')
      if (!safeHostname || safeHostname.includes('..')) continue

      const filename = safeHostname + '.png'
      const filepath = join(faviconDir, filename)
      const localPath = `/images/favicons/${filename}`

      // 优先从配置的 favicon 源下载真实图标（Google s2 国内被墙，不用作默认）
      let buf: Buffer | null = null
      try {
        const sourceUrl = getSourceUrl()
        const faviconUrl = sourceUrl
          .replace('{domain}', hostname)
          .replace('{size}', '64')
        const resp = await fetch(faviconUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000),
        })
        if (resp.ok) {
          const arrayBuf = await resp.arrayBuffer()
          const candidate = Buffer.from(arrayBuf)
          // 远程源返回的默认图标约 232 字节（灰色 globe），跳过
          if (candidate.length > 300 && isRasterIcon(candidate)) {
            buf = candidate
          }
        }
      } catch { /* 远程下载失败，继续使用浏览器缓存 */ }

      // 远程下载失败或返回默认图标，使用浏览器缓存的 base64
      if (!buf && item.base64) {
        const base64Data = item.base64.replace(/^data:image\/\w+;base64,/, '')
        const candidate = Buffer.from(base64Data, 'base64')
        // 跳过 Chrome 默认图标（~601 字节的灰色 globe）
        if (candidate.length > 300 && isRasterIcon(candidate)) {
          buf = candidate
        }
      }

      if (!buf) continue // 没有有效图标，跳过

      // 使用精确的域名匹配，避免 hostname 子串误匹配
      // LIKE '%://hostname/%' 会误匹配 'notexample.com' 当 hostname='example.com'
      const escapedHostname = hostname.replace(/[%_\\]/g, '\\$&')
      writeFileSync(filepath, buf)
      updateByHostname.run(localPath, userId, `%://${escapedHostname}/%`)
      count++
    } catch (e: any) {
      console.warn('[favicon] 保存失败:', item.url, e.message)
    }
  }

  return { success: true, count }
})
