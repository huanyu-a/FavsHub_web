#!/usr/bin/env node
/**
 * 对标站点白嫖渠道 → 本站「待审核」通告 导入器
 *
 * ## 为什么存在
 *
 * baipiao.org 的 `/free/` 板块收录了一批我们还没有的免费资源渠道。运营的诉求是
 * 「**先收进来、但别对外展示**」——所以本脚本把渠道落成 `status='pending'` 的通告：
 * 前端公开列表只出 `approved`，因此天然不可见；管理员在后台审核队列里逐条
 * **把链接替换成我方可用链接**后再手动通过。
 *
 * 为此每条通告的 `note` 开头都写了一行醒目提示（`【待替换链接】…`），并在
 * `source_url` 留了原情报地址（该列是运营字段，公开侧永不下发）。
 *
 * ## 幂等
 *
 * 主键为确定性 `bp-<slug>`。重跑时同 id 走 UPDATE，**不新增行**。
 * 由于 id 带 `bp-` 前缀，本脚本只可能动自己导入的行。
 * 脚本**不会**修改任何其它现有行的 `status`。
 *
 * ## 两条过滤策略（默认值都是刻意选的，勿「顺手修」）
 *
 * 1. **已失效不收**（默认）：对方标注「已到期 / 失效」的条目**默认不导入** ——
 *    我们要的是能薅的渠道，不复刻死资源。`--include-gone` 只是给人工「想看一眼」的旁路。
 * 2. **去重始终生效**：provider 名 或 注册域 命中本站已有 `token_deals` → 跳过。
 *    这是「对方有我方无」这条需求的直接实现。
 *
 * ⚠️ **`--include-gone` 只解除「已失效」过滤，不解除去重。**
 *    两者正交：即使加了 `--include-gone`，命中 provider / 注册域的条目**照样跳过**。
 *    所以「16 条已失效全收」不是 `--include-gone` 的承诺 —— 实测这 16 条里多数
 *    provider 与已导入行同名，会被去重拦掉（故收 119 而非 132）。
 *    **这是正确结果，不是 bug**：任何开关都不该让去重失效。
 *    若确实需要「全收」，那是另一个需求（要连 provider 去重一起关掉），
 *    请先与 lead 议定语义再加开关。
 *
 * ## 依赖 W1 契约（新列）
 *
 * `summary` / `limits` / `requirements` / `verify_scope` / `faq` / `source_url` / `featured`
 * 由后端任务新增。若尚未合并，本脚本用 `PRAGMA table_xinfo` 先探测；
 * **缺列就跳过该列写入并 warn**，绝不崩 —— 这样脚本可以在契约落地前后各跑一次。
 *
 * ## 用法
 *
 *   node scripts/import-baipiao-channels.mjs --dry-run
 *   node scripts/import-baipiao-channels.mjs --dry-run --limit=10
 *   node scripts/import-baipiao-channels.mjs --file=server/data/baipiao-channels.json
 *   NUXT_DB_PATH=/tmp/favshub-test.db node scripts/import-baipiao-channels.mjs
 *
 * 选项：
 *   --dry-run       只打印将新增/更新/跳过，不写库
 *   --limit=N       只处理前 N 条（用于抽查）
 *   --file=<path>   指定渠道 JSON（默认 server/data/baipiao-channels.json）
 *   --include-gone  连对方「已到期 / 失效」的条目也**参与考虑**（默认不参与）。
 *                   注意：它**只解锁「已失效」这一层过滤，不解锁去重** ——
 *                   命中去重的条目仍会被跳过，见上「两条过滤策略」。
 *   --quiet         只打结尾统计
 *
 * 数据库路径：`NUXT_DB_PATH` → 否则 `./data/favshub.db`（与既有 scripts/ 约定一致）。
 */

import Database from 'better-sqlite3'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ── CLI ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (name, dflt = null) => {
  const hit = argv.find((a) => a === name || a.startsWith(name + '='))
  if (!hit) return dflt
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const i = argv.indexOf(hit)
  return argv[i + 1] ?? dflt
}

const DRY_RUN = has('--dry-run') || has('--dry')
const QUIET = has('--quiet')
const INCLUDE_GONE = has('--include-gone')
const LIMIT = Number(val('--limit', '0')) || 0
const FILE = resolve(process.cwd(), val('--file', join('server', 'data', 'baipiao-channels.json')))
const DB_PATH = process.env.NUXT_DB_PATH
  ? resolve(process.cwd(), process.env.NUXT_DB_PATH)
  : join(process.cwd(), 'data', 'favshub.db')

const log = (...a) => { if (!QUIET) console.log(...a) }
const warn = (...a) => console.warn('⚠️ ', ...a)

// ── 契约：新列（缺席时跳过写入）───────────────────────────────────────
const NEW_COLUMNS = [
  ['summary', ''],
  ['limits', ''],
  ['requirements', ''],
  ['verify_scope', ''],
  ['faq', '[]'],
  ['source_url', ''],
  ['featured', 0],
]

/** 我方分类（W1 已把 domain 加入 DEAL_CATEGORIES） */
const CAT_FALLBACK = { token: 'token', cloud: 'cloud', domain: 'domain' }

/** 对方标注里出现这些词的，算「已不在架」 */
const GONE_HINTS = ['已到期', '失效', '下线', '结束']

// ── 工具 ──────────────────────────────────────────────────────────────
const MULTI_PART_TLDS = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'co.uk', 'org.uk', 'ac.uk',
  'co.jp', 'ne.jp', 'or.jp', 'com.hk', 'com.tw', 'com.au', 'com.br', 'co.kr',
  'com.sg', 'com.my', 'co.in', 'com.mx', 'co.za', 'com.tr', 'co.id', 'in.th',
])

/** 注册域：hostname 去 www，再按小型公共后缀表回退一级 */
function registrableDomain(url) {
  if (!url) return ''
  let host = ''
  try {
    host = new URL(String(url)).hostname.toLowerCase()
  } catch {
    const m = String(url).trim().match(/^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})/i)
    if (!m) return ''
    host = m[1].toLowerCase()
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '')
  if (!host || /^\d+(\.\d+){3}$/.test(host)) return host
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const last2 = parts.slice(-2).join('.')
  if (MULTI_PART_TLDS.has(last2) && parts.length >= 3) return parts.slice(-3).join('.')
  return last2
}

/** provider 归一：小写 + 去空白与标点，跨书写风格比较 */
const normProvider = (s) =>
  String(s || '').toLowerCase().replace(/[\s·・.。，,、\-_/\\()（）[\]【】:：'"]/g, '')

/** 来料 provider 是否命中已有集合（全等，或长度≥3 的双向包含） */
function providerHit(candidate, existingSet, existingList) {
  const n = normProvider(candidate)
  if (!n) return null
  if (existingSet.has(n)) return existingList.find((e) => e.norm === n)?.raw ?? candidate
  if (n.length >= 3) {
    for (const e of existingList) {
      if (e.norm.length >= 3 && (e.norm.includes(n) || n.includes(e.norm))) return e.raw
    }
  }
  return null
}

/** note 前缀：运营靠这一行在后台逐条定位「哪条还得换链接」 */
function buildNote(chan) {
  return [
    `【待替换链接】本条为对标站点导入，领取/官网链接需替换为本站可用链接后再审核发布。原情报：${chan.source_url}`,
    '',
    `· 对方核实状态：${chan.verify_status || '未标注'}${chan.verify_text ? `（${chan.verify_text}）` : ''}`,
    `· 对方收录时间：${chan.last_recorded_at ? new Date(chan.last_recorded_at).toISOString().slice(0, 10) : '未标注'}`,
    chan.official_url ? `· 对方给出的官方地址：${chan.official_url}` : '· 对方未给出可解析的官方地址',
    '',
    '以上为对方页面原文摘录，未做演绎；链接可用性以我方实测为准。',
  ].join('\n')
}

// ── 主流程 ────────────────────────────────────────────────────────────
function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`✖ 找不到数据库：${DB_PATH}`)
    process.exit(1)
  }
  if (!existsSync(FILE)) {
    console.error(`✖ 找不到渠道 JSON：${FILE}`)
    process.exit(1)
  }

  const doc = JSON.parse(readFileSync(FILE, 'utf8'))
  const channels = Array.isArray(doc.channels) ? doc.channels : []
  const rawTotal = channels.length

  if (!QUIET) {
    console.log('='.repeat(72))
    console.log('对标站点白嫖渠道 -> 待审核通告 导入器')
    console.log(`  数据库 : ${DB_PATH}`)
    console.log(`  渠道源 : ${FILE}`)
    console.log(`  模式   : ${DRY_RUN ? 'DRY-RUN（不写库）' : '实写'}`)
    console.log(`  条目   : ${rawTotal}（api ${doc.counts?.api ?? '?'} / server ${doc.counts?.server ?? '?'} / domain ${doc.counts?.domain ?? '?'}）`)
    console.log('='.repeat(72))
  }

  const db = new Database(DB_PATH, { timeout: 15000 })
  db.pragma('foreign_keys = ON')

  // ── 1. 列探测（W1 新列可能还没合并）─────────────────────────────────
  const liveCols = new Set(db.prepare('PRAGMA table_xinfo(token_deals)').all().map((r) => r.name))
  const absent = NEW_COLUMNS.filter(([c]) => !liveCols.has(c)).map(([c]) => c)
  const presentCount = NEW_COLUMNS.length - absent.length
  if (absent.length) {
    warn(`token_deals 缺少 ${absent.length} 个新列：${absent.join(', ')}`)
    warn('这些列本次跳过写入（不崩）。W1 合并后重跑本脚本即可补齐。')
  }
  if (!QUIET) {
    console.log(`\n[列探测] 存在 ${presentCount}/${NEW_COLUMNS.length} 个新列` +
      (absent.length ? `，缺：${absent.join(', ')}` : '（契约已就绪）'))
  }
  const hasCol = (c) => liveCols.has(c)

  // ── 2. 本站已有 provider / 注册域（去重基线）────────────────────────
  const existing = db.prepare('SELECT id, provider, url FROM token_deals').all()
  const existingProviders = []
  const seenNorm = new Set()
  for (const r of existing) {
    const n = normProvider(r.provider)
    if (n && !seenNorm.has(n)) {
      seenNorm.add(n)
      existingProviders.push({ norm: n, raw: r.provider })
    }
  }
  const existingDomains = new Set()
  for (const r of existing) {
    const d = registrableDomain(r.url)
    if (d) existingDomains.add(d)
  }
  log(`[去重基线] 本站已有 ${existing.length} 条通告，${existingDomains.size} 个注册域\n`)

  // ── 3. 逐条判定 ─────────────────────────────────────────────────────
  const stats = { insert: 0, update: 0, skipDup: 0, skipGone: 0, skipLimit: 0, errors: 0 }
  const skipLog = []
  const plan = []

  let considered = 0
  const findExisting = db.prepare('SELECT id FROM token_deals WHERE id = ?')
  for (const chan of channels) {
    if (!chan?.slug) { stats.errors++; warn('条目缺少 slug，已跳过'); continue }
    if (LIMIT && considered >= LIMIT) { stats.skipLimit++; continue }
    considered++

    // 对方已判失效的默认不收（用户要的是能薅的渠道）
    const statusText = String(chan.verify_status || '')
    if (!INCLUDE_GONE && GONE_HINTS.some((k) => statusText.includes(k))) {
      stats.skipGone++
      skipLog.push(`[对方已失效] ${chan.slug} — 对方标注「${statusText}」`)
      continue
    }

    const provider = String(chan.provider || '').trim()
    const id = `bp-${chan.slug}`

    // 去重（落实「对方有我方无」）：provider 名 或 注册域 命中已有 → 跳过
    const pHit = providerHit(provider, seenNorm, existingProviders)
    const dom = registrableDomain(chan.official_url || '')
    const dHit = dom && existingDomains.has(dom) ? dom : null
    if (pHit || dHit) {
      stats.skipDup++
      skipLog.push(`[已存在] ${chan.slug} — ` +
        (pHit ? `provider「${provider}」≈ 本站「${pHit}」` : `注册域 ${dHit} 已被本站收录`))
      continue
    }

    const category = CAT_FALLBACK[chan.category] || 'token'
    const exists = findExisting.get(id)
    if (exists) {
      stats.update++
      plan.push({ id, chan, category, action: 'update' })
    } else {
      stats.insert++
      plan.push({ id, chan, category, action: 'insert' })
    }
  }

  if (skipLog.length && !QUIET) {
    console.log(`── 跳过明细（${skipLog.length} 条）──`)
    for (const l of skipLog) console.log('  ' + l)
    console.log('')
  }

  // ── 4. 落库 ─────────────────────────────────────────────────────────
  const now = Date.now()
  const writable = NEW_COLUMNS.map(([c]) => c).filter(hasCol)

  const baseCols = [
    'id', 'user_id', 'provider', 'title', 'url', 'call_url', 'quota', 'models',
    'region', 'quality', 'source_tag', 'category', 'expires_at', 'pinned', 'note',
    'status', 'reject_reason', 'created_at', 'updated_at',
  ]
  for (const c of ['real_name', 'real_name_other']) if (hasCol(c)) baseCols.push(c)

  const insertCols = [...baseCols, ...writable]
  const insertSql = `INSERT INTO token_deals (${insertCols.join(', ')})
    VALUES (${insertCols.map(() => '?').join(', ')})`

  // UPDATE 只刷内容字段；status 恒为 pending（本脚本导入的行本就未被审核过），
  // 并把核实类字段重置为「从未核验」，避免历史串味。
  const updateCols = [
    'provider', 'title', 'url', 'call_url', 'quota', 'models', 'region', 'quality',
    'source_tag', 'category', 'expires_at', 'pinned', 'note', 'updated_at',
    ...writable,
    'real_name', 'real_name_other', 'verified_at', 'verified_by', 'verify_note',
  ].filter((c) => hasCol(c) || baseCols.includes(c))
  const updateSql = `UPDATE token_deals SET ${updateCols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`

  const stmtInsert = db.prepare(insertSql)
  const stmtUpdate = db.prepare(updateSql)

  const buildRow = (p) => ({
    id: p.id,
    user_id: 0,                       // 种子系统用户 _system
    provider: p.chan.provider || '',
    title: p.chan.title || p.chan.slug,
    url: p.chan.official_url || p.chan.source_url || '',   // ← 待用户替换
    call_url: '',
    quota: p.chan.quota || '',
    models: '[]',
    region: 'cn',                     // 不确定时用 cn，不瞎猜 global
    quality: '中品',                   // 占位，待人工核验后调整
    source_tag: 'community',
    category: p.category,
    expires_at: null,
    pinned: 0,
    note: buildNote(p.chan),
    status: 'pending',                // ← 「不对外展示」的实现
    reject_reason: '',
    created_at: now,
    updated_at: now,
    real_name: '',
    real_name_other: '',
    summary: p.chan.summary || '',
    limits: p.chan.limits || '',
    requirements: p.chan.requirements || '',
    verify_scope: p.chan.verify_scope || '',
    faq: '[]',                        // 对方页面无结构化 FAQ，不臆造
    source_url: p.chan.source_url || '',
    featured: 0,
    verified_at: 0,
    verified_by: '',
    verify_note: '',
  })

  if (!DRY_RUN && plan.length) {
    const tx = db.transaction((items) => {
      for (const p of items) {
        const row = buildRow(p)
        if (p.action === 'insert') stmtInsert.run(...insertCols.map((c) => row[c] ?? null))
        else stmtUpdate.run(...updateCols.map((c) => row[c] ?? null), row.id)
      }
    })
    tx(plan)
  }

  // ── 5. 统计 ─────────────────────────────────────────────────────────
  const skipped = stats.skipDup + stats.skipGone + stats.skipLimit
  console.log('\n' + '-'.repeat(72))
  console.log(`  新增  : ${stats.insert}`)
  console.log(`  更新  : ${stats.update}`)
  console.log(`  跳过  : ${skipped}  （已存在 ${stats.skipDup} / 对方已失效 ${stats.skipGone}` +
    (stats.skipLimit ? ` / 超 limit ${stats.skipLimit}` : '') + '）')
  console.log(`  总计  : ${rawTotal}`)
  if (absent.length) console.log(`  ⚠️  缺列未写：${absent.join(', ')}`)
  console.log(`  模式  : ${DRY_RUN ? 'DRY-RUN，未写库' : '已写入'}`)
  console.log('-'.repeat(72))

  db.close()
}

main()
