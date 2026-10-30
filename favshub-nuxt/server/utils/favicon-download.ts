/**
 * favicon 下载工具（SSRF 防护）— 供 admin 下载端点和公开代理端点复用
 */
import { writeFile } from 'node:fs'
import https from 'node:https'
import dns from 'node:dns'
import { getConfigInt } from './config'

/** 图标体积上限：正常 favicon 都在几百 KB 内，超限视为异常响应 */
const MAX_ICON_BYTES = 2 * 1024 * 1024

/**
 * 校验响应体是真实位图图标（PNG/JPEG/GIF/WebP/ICO/BMP）。
 * favicon 源对无图标站点会返回 SVG 字母标或 HTML 错误页，存成 .png 后
 * 浏览器按 image/png 解码失败、代理又会因"文件已存在"永远 302 坏文件，
 * 因此必须在落盘前拒绝非位图内容。
 */
export function isRasterIcon(buf: Buffer): boolean {
  if (!buf || buf.length < 8) return false
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true // PNG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true // JPEG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true // GIF
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return true
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return true // ICO
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true // BMP
  return false
}

/**
 * 内网 / 保留网段判定（CIDR）。
 *
 * 2026-10-30 审查后重写：原先只是一串 `startsWith` 前缀匹配，漏了
 * `100.64/10`（CGNAT）、`198.18/15`（基准测试保留段，**fake-ip 模式与透明代理常用**）、
 * `192.0.0/24`、`224/4`、`240/4`，以及 IPv4-mapped 的**十六进制**写法
 * （`::ffff:7f00:1` 就是 `127.0.0.1` —— 旧写法剥掉 `::ffff:` 后拿到 `7f00:1`，
 * 不是点分格式因而不匹配，实测该地址确实能连到 loopback）。
 */

/** IPv4 内网 / 保留段（网络号 + 前缀位数） */
const PRIVATE_V4_CIDRS: Array<[number[], number]> = [
  [[0, 0, 0, 0], 8],          // 「本网络」/ 未指定，含 0.0.0.0
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],      // CGNAT（运营商级 NAT）
  [[127, 0, 0, 0], 8],        // loopback
  [[169, 254, 0, 0], 16],     // link-local，含 169.254.169.254 云元数据
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],       // IETF 协议专用
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],      // 基准测试保留段
  [[224, 0, 0, 0], 4],        // 组播
  [[240, 0, 0, 0], 4],        // 保留（含 255.255.255.255 广播）
]

/** IPv6 内网 / 保留段（字节前缀 + 前缀位数） */
const PRIVATE_V6_CIDRS: Array<[number[], number]> = [
  [[0xfe, 0x80], 10],                     // link-local fe80::/10
  [[0xfc], 7],                            // unique local fc00::/7
  [[0x00, 0x64, 0xff, 0x9b], 96],         // NAT64 64:ff9b::/96
]

/** IPv4-mapped（::ffff:0:0/96）与 IPv4-compatible（::/96）—— 内层按 IPv4 递归判定 */
const V4_MAPPED_PREFIX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff]
const V4_COMPAT_PREFIX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

function parseIPv4(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some(p => p > 255)) return null
  return parts
}

/** 把 IPv6 字符串解析成 16 字节（支持 `::` 压缩与末尾点分 IPv4），失败返回 null */
function parseIPv6(host: string): number[] | null {
  let h = host.trim().toLowerCase()
  if (!h.includes(':')) return null

  // 末尾的点分 IPv4 折成两个十六进制组：::ffff:127.0.0.1 → ::ffff:7f00:1
  const lastColon = h.lastIndexOf(':')
  if (lastColon >= 0 && h.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(h.slice(lastColon + 1))
    if (!v4) return null
    const hi = ((v4[0] << 8) | v4[1]).toString(16)
    const lo = ((v4[2] << 8) | v4[3]).toString(16)
    h = `${h.slice(0, lastColon + 1)}${hi}:${lo}`
  }

  const dbl = h.indexOf('::')
  let head: string[]
  let tail: string[] = []
  if (dbl >= 0) {
    if (h.indexOf('::', dbl + 1) >= 0) return null // `::` 只能出现一次
    const before = h.slice(0, dbl)
    const after = h.slice(dbl + 2)
    head = before ? before.split(':') : []
    tail = after ? after.split(':') : []
    if (head.length + tail.length > 7) return null
  } else {
    head = h.split(':')
    if (head.length !== 8) return null
  }

  const groups: number[] = []
  const push = (list: string[]) => {
    for (const g of list) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return false
      groups.push(parseInt(g, 16))
    }
    return true
  }
  if (!push(head)) return null
  if (dbl >= 0) for (let i = 0; i < 8 - head.length - tail.length; i++) groups.push(0)
  if (!push(tail)) return null
  if (groups.length !== 8) return null

  const bytes: number[] = []
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff)
  return bytes
}

/** 字节数组是否落在某个 CIDR 前缀内 */
function matchCidr(bytes: number[], prefix: number[], bits: number): boolean {
  const full = Math.floor(bits / 8)
  for (let i = 0; i < full; i++) if (bytes[i] !== prefix[i]) return false
  const rem = bits % 8
  if (rem) {
    const mask = (0xff << (8 - rem)) & 0xff
    if ((bytes[full] & mask) !== (prefix[full] & mask)) return false
  }
  return true
}

function isPrivateIPv4Bytes(b: number[]): boolean {
  return PRIVATE_V4_CIDRS.some(([prefix, bits]) => matchCidr(b, prefix, bits))
}

/** 判断主机名/IP 是否指向内网或保留地址（**DNS 解析结果也要过这一关**） */
export function isPrivateIP(hostname: string): boolean {
  const h = (hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true

  const v6 = parseIPv6(h)
  if (v6) {
    // 内嵌 IPv4 的两种映射形式：先剥出后 4 字节按 IPv4 规则判（递归）
    if (matchCidr(v6, V4_MAPPED_PREFIX, 96) || matchCidr(v6, V4_COMPAT_PREFIX, 96)) {
      return isPrivateIPv4Bytes(v6.slice(12))
    }
    return PRIVATE_V6_CIDRS.some(([prefix, bits]) => matchCidr(v6, prefix, bits))
  }

  const v4 = parseIPv4(h)
  if (v4) return isPrivateIPv4Bytes(v4)

  if (h === 'metadata.google.internal') return true
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

        // 无 UA 的请求会被 favicon 源（如 favicon.im 的 Cloudflare）直接 403
        const req = https.get(url, {
          timeout,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
        }, (response) => {
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
          if (response.statusCode !== 200) { response.resume(); return reject(new Error('HTTP ' + response.statusCode)) }
          // 先缓冲校验再落盘：直接 pipe 会把 SVG/HTML 占位写进 .png，之后代理见"文件已存在"永远 302 坏文件
          const chunks: Buffer[] = []
          let size = 0
          response.on('data', (c: Buffer) => {
            size += c.length
            if (size > MAX_ICON_BYTES) { response.destroy(); reject(new Error('图标体积超限')) ; return }
            chunks.push(c)
          })
          response.on('end', () => {
            const buf = Buffer.concat(chunks)
            if (!isRasterIcon(buf)) return reject(new Error('响应不是位图图标（SVG/HTML 占位）'))
            writeFile(destPath, buf, (err) => (err ? reject(err) : resolve()))
          })
          response.on('error', reject)
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      })
    } catch (e) {
      reject(e)
    }
  })
}
