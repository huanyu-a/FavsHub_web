import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'
import http from 'node:http'
import dns from 'node:dns'
import Database from 'better-sqlite3'

const OUR_DIR = join(process.cwd(), 'public', 'images', 'favicons')
const DB_PATH = join(process.cwd(), 'data', 'favshub.db')
const DNS_TO = 3000  // 3s DNS timeout

if (!existsSync(OUR_DIR)) mkdirSync(OUR_DIR, { recursive: true })

// DNS with timeout
function dnsLookup(hostname) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dns timeout')), DNS_TO)
    dns.lookup(hostname, (err, addr) => {
      clearTimeout(timer)
      err ? reject(err) : resolve(addr)
    })
  })
}

function tryDownload(hostname) {
  return new Promise((resolve) => {
    const safe = hostname.replace(/[^a-zA-Z0-9.-]/g, '')
    const dest = join(OUR_DIR, safe + '.ico')
    if (existsSync(dest)) return resolve({ hostname, ok: 'existed' })

    const urls = [`https://${hostname}/favicon.ico`, `http://${hostname}/favicon.ico`]
    // also try without www
    const noW = hostname.replace(/^www\./, '')
    if (noW !== hostname) {
      urls.push(`https://${noW}/favicon.ico`, `http://${noW}/favicon.ico`)
    }

    let idx = 0
    function next() {
      if (idx >= urls.length) return resolve({ hostname, ok: false })
      const url = urls[idx++]
      let proto = url.startsWith('https') ? https : http

      dnsLookup(new URL(url).hostname).then(() => {
        const req = proto.get(url, { timeout: 5000 }, (res) => {
          if (res.statusCode !== 200) return next()
          const chunks = []
          res.on('data', c => chunks.push(c))
          res.on('end', () => {
            const buf = Buffer.concat(chunks)
            if (buf.length < 50) return next()
            writeFileSync(dest, buf)
            resolve({ hostname, ok: true, size: buf.length })
          })
        })
        req.on('error', () => next())
        req.on('timeout', () => { req.destroy(); next() })
      }).catch(() => next())
    }
    next()
  })
}

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// Collect hostnames from HTTP-icon and webp-icon bookmarks
const httpRows = db.prepare(`SELECT DISTINCT substr(url, instr(url, '://') + 3) as hp FROM bookmarks WHERE icon LIKE 'http%'`).all()
const webpRows = db.prepare(`SELECT DISTINCT substr(url, instr(url, '://') + 3) as hp FROM bookmarks WHERE icon LIKE 'img/%.webp'`).all()
const hostnames = [...new Set([...httpRows, ...webpRows].map(r => r.hp.split('/')[0]))]

console.log(`${hostnames.length} hostnames to try`)
const start = Date.now()

let ok = 0, fail = 0, exist = 0, done = 0
const BATCH = 10 // smaller batches for DNS

for (let i = 0; i < hostnames.length; i += BATCH) {
  const batch = hostnames.slice(i, i + BATCH)
  const results = await Promise.all(batch.map(tryDownload))
  for (const r of results) {
    done++
    if (r.ok === true) ok++
    else if (r.ok === 'existed') exist++
    else fail++
  }
  console.log(`[${done}/${hostnames.length}] ok:${ok} fail:${fail} exist:${exist}`)
}

// Update DB
const updateStmt = db.prepare('UPDATE bookmarks SET icon = ? WHERE url LIKE ?')
let updated = 0
for (const hostname of hostnames) {
  const safe = hostname.replace(/[^a-zA-Z0-9.-]/g, '')
  if (existsSync(join(OUR_DIR, safe + '.ico'))) {
    const r = updateStmt.run(`/images/favicons/${safe}.ico`, `%://${hostname}/%`)
    updated += r.changes
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(0)
console.log(`\n[DONE] ${elapsed}s  ok:${ok}  fail:${fail}  exist:${exist}  db:${updated}`)

const s = db.prepare(`SELECT COUNT(*) as t, SUM(CASE WHEN icon LIKE '/images/%' THEN 1 ELSE 0 END) as lcl FROM bookmarks`).get()
console.log(`Total: ${s.t} | Local: ${s.lcl} (${(s.lcl/s.t*100).toFixed(1)}%)`)

db.close()
