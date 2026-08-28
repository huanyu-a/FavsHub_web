/**
 * favicon 下载工具（SSRF 防护）— 供 admin 下载端点和公开代理端点复用
 */
import { createWriteStream } from 'node:fs'
import https from 'node:https'
import dns from 'node:dns'
import { getConfigInt } from './config'

export function isPrivateIP(hostname: string): boolean {
  let h = hostname.toLowerCase()
  if (h.startsWith('::ffff:')) h = h.slice(7)
  const privateIPv4 = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.)/
  if (privateIPv4.test(h)) return true
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true
  return false
}

/** 域名级内网/私有判断（下载前先拦截，避免无效 DNS 解析） */
export function isPrivateHostname(hostname: string): boolean {
  const h = (hostname || '').toLowerCase().replace(/\.$/, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.intranet') || h.endsWith('.internal') || h.endsWith('.localdomain')) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateIP(h)
  if (h.includes(':')) return true
  return false
}

export function downloadFavicon(url: string, destPath: string, _redirectDepth = 0): Promise<void> {
  const MAX_REDIRECTS = getConfigInt('favicon_max_redirects', 3)
  const timeout = getConfigInt('favicon_download_timeout', 10000)
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:') return reject(new Error('仅支持 HTTPS 协议'))
      if (isPrivateIP(u.hostname)) return reject(new Error('不允许访问内网地址'))

      // DNS 解析后校验 IP，防止 DNS rebinding SSRF
      dns.lookup(u.hostname, (dnsErr, address) => {
        if (dnsErr) return reject(new Error('DNS 解析失败: ' + dnsErr.message))
        if (isPrivateIP(address)) return reject(new Error('不允许访问内网地址'))

        const req = https.get(url, { timeout }, (response) => {
          if (response.statusCode! >= 300 && response.statusCode! < 400 && response.headers.location) {
            if (_redirectDepth >= MAX_REDIRECTS) return reject(new Error('重定向次数超限'))
            const redirectUrl = response.headers.location.startsWith('http')
              ? response.headers.location
              : new URL(response.headers.location, u.origin).href
            const rUrl = new URL(redirectUrl)
            dns.lookup(rUrl.hostname, (err, addr) => {
              if (err) return reject(new Error('DNS 解析失败: ' + err.message))
              if (isPrivateIP(addr)) return reject(new Error('重定向目标为内网地址'))
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
      })
    } catch (e) {
      reject(e)
    }
  })
}
