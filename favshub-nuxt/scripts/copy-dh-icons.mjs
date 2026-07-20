import { readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DH_DIR = 'C:/project/wwwroot/DH_NavHub/img/favicon'
const OUR_DIR = join(__dirname, '..', 'public', 'images', 'favicons')
const DB_PATH = join(__dirname, '..', 'data', 'favshub.db')

if (!existsSync(OUR_DIR)) mkdirSync(OUR_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// Get available DH favicon dirs and their files
const dhDirs = {}
for (const d of readdirSync(DH_DIR, { withFileTypes: true })) {
  if (!d.isDirectory()) continue
  const files = readdirSync(join(DH_DIR, d.name))
  if (files.length > 0) dhDirs[d.name] = files[0]
}

// Service name → likely hostname patterns
// Derived from looking at the DH_NavHub favicon dir names
const SERVICE_MAP = {
  aliyundrive: ['aliyundrive.com'],
  quark: ['pan.quark.cn'],
  panbaidu: ['pan.baidu.com'],
  gtimg: ['gtimg.com', 'qpic.cn', 'qq.com'],
  aiosearch: ['aiosearch.com'],
  ghproxy: ['ghproxy.com', 'ghproxy.net'],
  hdmoli: ['hdmoli.com', 'hdmoli'],
  jrskbs: ['jrskbs.com'],
  macdo: ['macdo.cn'],
  coolors: ['coolors.co'],
  zhaotaici: ['zhaotaici.com'],
  '47.112.23.238': ['47.112.23.238'],
  'c-t': ['c-t.work', 'c-t'],
}

// For each service, check if the DH dir exists and what hostnames are in our DB
let copied = 0, updated = 0

for (const [dirName, patterns] of Object.entries(SERVICE_MAP)) {
  const file = dhDirs[dirName]
  if (!file) continue

  const srcPath = join(DH_DIR, dirName, file)
  const ext = extname(file)

  for (const pattern of patterns) {
    // Find hostnames in DB matching this pattern
    const hostRows = db.prepare(`
      SELECT DISTINCT substr(url, instr(url, '://') + 3) as hp
      FROM bookmarks WHERE url LIKE ?
    `).all(`%://%${pattern}%`)

    if (hostRows.length === 0) continue

    for (const hr of hostRows) {
      const hostname = hr.hp.split('/')[0].split('?')[0]
      const safeHostname = hostname.replace(/[^a-zA-Z0-9.-]/g, '')
      const destPath = join(OUR_DIR, safeHostname + ext)

      // Copy icon
      copyFileSync(srcPath, destPath)
      copied++

      // Update all bookmarks for this hostname
      const localPath = `/images/favicons/${safeHostname}${ext}`
      const r = db.prepare('UPDATE bookmarks SET icon = ? WHERE url LIKE ?').run(localPath, `%://${hostname}/%`)
      updated += r.changes
    }
  }
}

console.log(`Copied: ${copied} icon files`)
console.log(`Updated: ${updated} bookmarks`)

// Final stats
const stats = db.prepare(`SELECT
  COUNT(*) as total,
  SUM(CASE WHEN icon LIKE '/images/%' THEN 1 ELSE 0 END) as local,
  SUM(CASE WHEN icon NOT LIKE '/images/%' AND icon IS NOT NULL AND icon != '' THEN 1 ELSE 0 END) as remote
FROM bookmarks`).get()
console.log(`Total: ${stats.total} | Local icons: ${stats.local} | Remote: ${stats.remote}`)

db.close()
