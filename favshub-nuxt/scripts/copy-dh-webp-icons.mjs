/**
 * 从 DH_NavHub JSON 源数据提取 img/{hash}.webp → hostname 映射，
 * 复制图标到 public/images/favicons/ 并更新 DB
 */
import { readFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DH_JSON_DIR = 'C:/project/wwwroot/DH_NavHub/data'
const DH_IMG_DIR = 'C:/project/wwwroot/DH_NavHub/img'
const OUR_DIR = join(__dirname, '..', 'public', 'images', 'favicons')
const DB_PATH = join(__dirname, '..', 'data', 'favshub.db')

if (!existsSync(OUR_DIR)) mkdirSync(OUR_DIR, { recursive: true })

const JSON_FILES = [
  '00阿里资源.json', '01在线服务.json', '01资源.json', '02服务.json',
  '02工具.json', '03软件.json', '04影音娱乐.json', '05生产力.json', '06信息.json',
]

// 1. Build hostname → icon hash mapping from JSON files
const mapping = new Map() // hostname → { iconPath, proxy }
for (const filename of JSON_FILES) {
  let data
  try {
    data = JSON.parse(readFileSync(join(DH_JSON_DIR, filename), 'utf-8'))
  } catch { continue }

  for (const cat of data.categories || []) {
    for (const site of cat.sites || []) {
      const icon = (site.icon || '').trim()
      // Only care about img/ paths (not img/favicon/ which were already handled)
      if (!icon.startsWith('img/') || icon.startsWith('img/favicon/')) continue
      try {
        const hostname = new URL(site.url).hostname
        if (!mapping.has(hostname)) {
          mapping.set(hostname, icon)
        }
      } catch {}
    }
  }
}

console.log(`Found ${mapping.size} hostname → icon mappings`)

// 2. Copy icons
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

let copied = 0, updated = 0, missing = 0

for (const [hostname, iconPath] of mapping) {
  const srcPath = join(DH_IMG_DIR, iconPath.replace('img/', ''))
  if (!existsSync(srcPath)) { missing++; continue }

  const ext = extname(iconPath)
  const safeHostname = hostname.replace(/[^a-zA-Z0-9.-]/g, '')
  const destPath = join(OUR_DIR, safeHostname + ext)

  copyFileSync(srcPath, destPath)
  copied++

  const localPath = `/images/favicons/${safeHostname}${ext}`
  const r = db.prepare('UPDATE bookmarks SET icon = ? WHERE url LIKE ?')
    .run(localPath, `%://${hostname}/%`)
  updated += r.changes
}

console.log(`Copied: ${copied} | Updated: ${updated} | Missing: ${missing}`)

// Stats
const s = db.prepare(`SELECT
  COUNT(*) as total,
  SUM(CASE WHEN icon LIKE '/images/%' THEN 1 ELSE 0 END) as local,
  SUM(CASE WHEN icon NOT LIKE '/images/%' AND icon IS NOT NULL AND icon != '' THEN 1 ELSE 0 END) as remote
FROM bookmarks`).get()
console.log(`Total: ${s.total} | Local: ${s.local} | Remote: ${s.remote}`)

db.close()
