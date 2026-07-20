import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'
import http from 'node:http'
import Database from 'better-sqlite3'

const URLS = [
  'https://pc.woozooo.com/favicon.ico',
  'https://www.lanzoui.com/favicon.ico',
  'https://www.lanzou.com/favicon.ico',
  'http://lanzou.com/favicon.ico',
]
const ICON_NAME = 'www.lanzoux.com.png'
const DEST = join(process.cwd(), 'public', 'images', 'favicons', ICON_NAME)

function tryDownload(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        const loc = res.headers.location
        if (loc) { tryDownload(loc).then(resolve).catch(reject); return }
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function main() {
  for (const url of URLS) {
    console.log(`Trying: ${url}`)
    try {
      const buf = await tryDownload(url)
      writeFileSync(DEST, buf)
      console.log(`Saved: ${ICON_NAME} (${buf.length} bytes)`)

      const db = new Database('./data/favshub.db')
      const localPath = '/images/favicons/www.lanzoux.com.png'

      // Match any lanzou-related URL
      const r = db.prepare(`UPDATE bookmarks SET icon = ? WHERE url LIKE '%lanzou%'`).run(localPath)
      console.log(`Updated: ${r.changes} bookmarks`)
      db.close()
      console.log('Done!')
      return
    } catch (e) {
      console.log(`  Failed: ${e.message}`)
    }
  }
  console.log('All URLs failed')
}

main()
