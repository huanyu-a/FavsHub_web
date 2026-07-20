import Database from 'better-sqlite3'

const db = new Database('./data/favshub.db')

const rows = db.prepare(`SELECT url, icon FROM bookmarks WHERE icon LIKE 'img/%' AND icon NOT LIKE 'img/favicon/%' LIMIT 30`).all()

console.log('Sample bookmarks with img/{hash}.webp icons:\n')
rows.forEach(r => {
  const icon = r.icon.replace('img/', '')
  try {
    const hostname = new URL(r.url).hostname
    console.log(`${hostname}`)
    console.log(`  icon: ${icon}`)
    console.log(`  url:  ${r.url.substring(0, 100)}`)
    console.log()
  } catch {}
})

// Group by icon
const grouped = db.prepare(`SELECT icon, COUNT(*) as cnt, GROUP_CONCAT(substr(url,1,60), ' | ') as urls FROM bookmarks WHERE icon LIKE 'img/%' AND icon NOT LIKE 'img/favicon/%' GROUP BY icon ORDER BY cnt DESC LIMIT 15`).all()
console.log('---')
console.log('Top 15 icons by usage:')
grouped.forEach(g => console.log(`  ${g.cnt}×  ${g.icon}`))

db.close()
