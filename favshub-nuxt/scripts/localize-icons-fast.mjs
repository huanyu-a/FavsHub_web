/**
 * 批量下载书签图标到本地（并发版）
 * 用法: node scripts/localize-icons-fast.mjs [并发数]
 */
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'
import dns from 'node:dns'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'

const PUBLIC_DIR = join(process.cwd(), 'public')
const FAVICON_DIR = join(PUBLIC_DIR, 'images', 'favicons')
const DB_PATH = join(process.cwd(), 'data', 'favshub.db')
const CONCURRENCY = parseInt(process.argv[2]) || 20
const DNS_TIMEOUT = 5000  // 5s DNS 超时
const HTTP_TIMEOUT = 8000 // 8s HTTP 超时

function isPrivateIP(hostname) {
  let h = hostname.toLowerCase()
  if (h.startsWith('::ffff:')) h = h.slice(7)
  if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.)/.test(h)) return true
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  return false
}

function dnsLookup(hostname) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT)
    dns.lookup(hostname, (err, address) => {
      clearTimeout(timer)
      if (err) return reject(err)
      if (isPrivateIP(address)) return reject(new Error('内网'))
      resolve(address)
    })
  })
}

function downloadFavicon(url, destPath, depth = 0) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:') return reject(new Error('非HTTPS'))

      dnsLookup(u.hostname).then(() => {
        const req = https.get(url, { timeout: HTTP_TIMEOUT }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (depth >= 3) return reject(new Error('重定向超限'))
            const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, u.origin).href
            downloadFavicon(loc, destPath, depth + 1).then(resolve).catch(reject)
            return
          }
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode))
          const file = createWriteStream(destPath)
          file.on('finish', () => { file.close(); resolve() })
          file.on('error', reject)
          res.pipe(file)
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      }).catch(reject)
    } catch (e) { reject(e) }
  })
}

// ─── Main ───
if (!existsSync(FAVICON_DIR)) mkdirSync(FAVICON_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

const bookmarks = db.prepare(`
  SELECT id, url, icon FROM bookmarks
  WHERE icon IS NOT NULL AND icon != '' AND icon NOT LIKE '/images/favicons/%'
`).all()

console.log(`[INFO] 共 ${bookmarks.length} 条书签需要处理图标`)

const hostGroups = new Map()
for (const bm of bookmarks) {
  try {
    const hostname = new URL(bm.url).hostname
    if (!hostGroups.has(hostname)) hostGroups.set(hostname, [])
    hostGroups.get(hostname).push(bm.id)
  } catch { /* skip */ }
}

// 过滤掉已存在图标文件的域名（上次运行已下载）
let alreadyHave = 0
const pending = []
for (const [hostname, ids] of hostGroups) {
  const safe = hostname.replace(/[^a-zA-Z0-9.-]/g, '')
  if (!safe || safe.includes('..')) continue
  if (existsSync(join(FAVICON_DIR, safe + '.png'))) {
    alreadyHave++
    continue
  }
  pending.push({ hostname, safeHostname: safe, ids })
}

console.log(`[INFO] ${hostGroups.size} 个独立域名，${pending.length} 个待下载，${alreadyHave} 个已存在`)
console.log(`[INFO] 并发数: ${CONCURRENCY}`)

const updateStmt = db.prepare("UPDATE bookmarks SET icon = ? WHERE url LIKE ?")
let downloaded = 0, failed = 0
const startTime = Date.now()

// 并发池
async function runConcurrently(items, concurrency, worker) {
  const results = []
  const queue = [...items]
  async function next() {
    while (queue.length > 0) {
      const item = queue.shift()
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()))
  return results
}

let n = 0
await runConcurrently(pending, CONCURRENCY, async ({ hostname, safeHostname, ids }) => {
  const destPath = join(FAVICON_DIR, safeHostname + '.png')
  const url = `https://www.google.com/s2/favicons?domain=${safeHostname}&sz=32`
  const localPath = `/images/favicons/${safeHostname}.png`

  try {
    await downloadFavicon(url, destPath)
    updateStmt.run(localPath, `%://${hostname}/%`)
    downloaded++
  } catch {
    failed++
  }

  n++
  if (n % 100 === 0 || n === pending.length) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
    console.log(`[${n}/${pending.length}] 已下载:${downloaded} 失败:${failed} 耗时:${elapsed}s`)
  }
})

const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
console.log(`\n[DONE] 耗时 ${elapsed}s  新下载:${downloaded}  失败:${failed}  已存在:${alreadyHave}`)

// 对已存在图标的域名更新 DB 引用
if (alreadyHave > 0) {
  console.log(`[INFO] 更新 ${alreadyHave} 个已存在域名的 DB 引用...`)
  let updated = 0
  for (const [hostname, ids] of hostGroups) {
    const safe = hostname.replace(/[^a-zA-Z0-9.-]/g, '')
    if (!safe || safe.includes('..')) continue
    if (existsSync(join(FAVICON_DIR, safe + '.png'))) {
      const r = updateStmt.run(`/images/favicons/${safe}.png`, `%://${hostname}/%`)
      updated += r.changes
    }
  }
  console.log(`[INFO] 已更新 ${updated} 条书签的图标路径`)
}

db.close()
