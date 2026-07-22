import Database from 'better-sqlite3'

const db = new Database('./data/favshub.db')

const rows = db.prepare(`SELECT url, icon FROM bookmarks
  WHERE icon IS NOT NULL AND icon != '' AND icon NOT LIKE '/images/%' AND icon NOT LIKE 'data:%'`).all()

const hostMap = new Map()
for (const r of rows) {
  try {
    const hostname = new URL(r.url).hostname.replace(/^www\./, '')
    if (!hostMap.has(hostname)) hostMap.set(hostname, { cnt: 0, sampleUrl: r.url })
    hostMap.get(hostname).cnt++
  } catch {}
}

const sorted = [...hostMap.entries()].sort((a, b) => b[1].cnt - a[1].cnt)

console.log(`${rows.length} non-local bookmarks, ${sorted.length} unique domains:\n`)
sorted.forEach(([host, info]) => {
  console.log(`  ${info.cnt.toString().padStart(3)}×  ${host.padEnd(40)}  ${info.sampleUrl}`)
})

const empty = db.prepare(`SELECT COUNT(*) as cnt FROM bookmarks WHERE icon IS NULL OR icon = ''`).get()
console.log(`\n  ${empty.cnt}×  (no icon at all)`)

db.close()
