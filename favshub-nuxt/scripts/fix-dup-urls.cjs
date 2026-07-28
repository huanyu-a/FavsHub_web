/**
 * 一次性数据修复脚本（先用 dry-run 审阅，再加 --apply 执行）
 *
 * 功能：
 *  1. 合并同一用户下「仅结尾 / 不同」的重复书签（如 248/1555）：
 *     - 保留 id 最小的一条
 *     - collection_bookmarks 引用重定向到保留行（同精选集冲突则删重定向行）
 *     - collection_imports.bookmark_id 重定向
 *     - 删除重复行
 *  2. --pool-ids=92,123 给指定书签追加 pool 标签（双属性：个人+公共池）
 *
 * 用法：
 *   node scripts/fix-dup-urls.cjs                 # dry-run 仅报告
 *   node scripts/fix-dup-urls.cjs --apply         # 执行合并
 *   node scripts/fix-dup-urls.cjs --apply --pool-ids=92
 */
const path = require('path')
const Database = require('better-sqlite3')

const DB_PATH = process.env.NUXT_DB_PATH || path.join(__dirname, '..', 'data', 'favshub.db')
const APPLY = process.argv.includes('--apply')
const poolIdsArg = (process.argv.find(a => a.startsWith('--pool-ids=')) || '').replace('--pool-ids=', '')
const poolIds = poolIdsArg ? poolIdsArg.split(',').map(s => parseInt(s.trim())).filter(n => !Number.isNaN(n)) : []

function normalizeUrl(url) {
  let u = (url || '').trim()
  while (u.length > 1 && u.endsWith('/') && !u.endsWith('://')) u = u.slice(0, -1)
  return u
}

const db = new Database(DB_PATH)
console.log(`DB: ${DB_PATH}`)
console.log(APPLY ? '== APPLY 模式（将写入） ==' : '== DRY-RUN 模式（仅报告） ==')

// ── 1. 查找重复组 ────────────────────────────────────────────
const rows = db.prepare('SELECT id, user_id, url, label FROM bookmarks ORDER BY id').all()
const groups = new Map() // key: user_id + '\n' + normalizedUrl -> rows[]
for (const r of rows) {
  const key = r.user_id + '\n' + normalizeUrl(r.url)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}
const dupGroups = [...groups.values()].filter(g => g.length > 1)

// 需要归一化改写的单条 URL（合并后统一去尾 /，保证 sync 查重命中）
const toNormalize = rows.filter(r => normalizeUrl(r.url) !== r.url)

console.log(`\n[重复组合并] 发现 ${dupGroups.length} 组仅结尾 / 不同的重复书签：`)
for (const g of dupGroups) {
  const keep = g[0]
  for (const d of g.slice(1)) {
    console.log(`  keep #${keep.id} (${keep.url})  <-  drop #${d.id} (${d.url})`)
  }
}
console.log(`\n[URL 归一化] ${toNormalize.length} 条书签订将被改写为去尾 / 形式`) 

// ── 2. pool 标签追加 ─────────────────────────────────────────
if (poolIds.length) {
  console.log(`\n[pool 标签] 待追加: ${poolIds.join(', ')}`)
  const stmt = db.prepare('SELECT id, url, label FROM bookmarks WHERE id = ?')
  for (const id of poolIds) {
    const bm = stmt.get(id)
    if (!bm) { console.log(`  #${id}: 不存在，跳过`); continue }
    const tags = String(bm.label || '').split(',').map(s => s.trim()).filter(Boolean)
    const newLabel = tags.includes('pool') ? tags.join(',') : [...tags, 'pool'].join(',')
    console.log(`  #${id} (${bm.url}): '${bm.label}' -> '${newLabel}'`)
  }
}

if (!APPLY) {
  console.log('\n（dry-run，未写入。加 --apply 执行）')
  process.exit(0)
}

// ── 执行 ────────────────────────────────────────────────────
const tx = db.transaction(() => {
  let merged = 0
  const cbList = db.prepare('SELECT id, collection_id FROM collection_bookmarks WHERE bookmark_id = ?')
  const cbExists = db.prepare('SELECT 1 FROM collection_bookmarks WHERE collection_id = ? AND bookmark_id = ?')
  const cbMove = db.prepare('UPDATE collection_bookmarks SET bookmark_id = ? WHERE id = ?')
  const cbDrop = db.prepare('DELETE FROM collection_bookmarks WHERE id = ?')
  const ciMove = db.prepare('UPDATE collection_imports SET bookmark_id = ? WHERE bookmark_id = ?')
  const bmDrop = db.prepare('DELETE FROM bookmarks WHERE id = ?')

  for (const g of dupGroups) {
    const keep = g[0]
    for (const d of g.slice(1)) {
      for (const cb of cbList.all(d.id)) {
        if (cbExists.get(cb.collection_id, keep.id)) cbDrop.run(cb.id)
        else cbMove.run(keep.id, cb.id)
      }
      ciMove.run(keep.id, d.id)
      bmDrop.run(d.id)
      merged++
    }
  }
  console.log(`\n[已合并] ${merged} 条重复书签`)

  // 全库 URL 归一化（须在合并之后执行，避免 UNIQUE 冲突）
  const urlSet = db.prepare('UPDATE bookmarks SET url = ? WHERE id = ?')
  let normalized = 0
  const remainRows = db.prepare('SELECT id, url FROM bookmarks').all()
  for (const r of remainRows) {
    const n = normalizeUrl(r.url)
    if (n !== r.url) { urlSet.run(n, r.id); normalized++ }
  }
  console.log(`[URL 归一化] 已改写 ${normalized} 条`)

  if (poolIds.length) {
    const getStmt = db.prepare('SELECT label FROM bookmarks WHERE id = ?')
    const setStmt = db.prepare('UPDATE bookmarks SET label = ?, updated_at = ? WHERE id = ?')
    for (const id of poolIds) {
      const bm = getStmt.get(id)
      if (!bm) continue
      const tags = String(bm.label || '').split(',').map(s => s.trim()).filter(Boolean)
      if (!tags.includes('pool')) tags.push('pool')
      setStmt.run(tags.join(','), Date.now(), id)
    }
    console.log(`[pool 标签] 已追加到: ${poolIds.join(', ')}`)
  }
})
tx()
console.log('完成。')
