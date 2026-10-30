#!/usr/bin/env node
/**
 * public-field-matrix.mjs — 公开出口 × 内部字段 全矩阵回归
 *
 * 为什么要有这个脚本（2026-10-30 四轮教训）：
 *   同一个 `token_deals` 表被**多个端点**以 `{ ...row, ...覆盖 }` 的方式展开。
 *   修脱敏时很容易只改一处 —— 上一轮就给详情剔除了 `deleted_at` / `invalid_reason`，
 *   却漏了列表端点（两者写法一模一样），生产上列表 37 个字段里两个都在。
 *   单元测试当时全绿，因为我只验了详情。
 *
 *   这个脚本把「端点 × 字段」做成矩阵，任何组合泄露都会直接列出来。
 *
 * 用法：node scripts/public-field-matrix.mjs [baseUrl]
 *   默认打生产 https://hao.bx9y.com.cn —— 这是**只读**探针，不改任何数据。
 */
const BASE = (process.argv[2] || 'https://hao.bx9y.com.cn').replace(/\/+$/, '')

// 绝不能出现在公开响应里的键（键不出现，或值必须为空）
const INTERNAL_KEYS = ['deleted_at', 'invalid_reason', 'deleted_by', 'user_id', 'guest_fingerprint']
// 键保留但值必须为空串的例外
const EMPTY_ONLY = ['verified_by']
// 前端依赖、脱敏时必须保留的字段（防「脱敏过界」）
const MUST_KEEP = ['verified_at', 'note_html', 'reject_reason']  // 仅 token_deals 适用

let pass = 0, fail = 0, skip = 0
const bad = (msg, detail) => { fail++; console.log(`  ✗ ${msg}${detail ? ' — ' + detail : ''}`) }
const ok = (msg) => { pass++; console.log(`  ✓ ${msg}`) }
// 跳过：**不计入通过**，单独计数并在汇总里显示，避免「skip 冒充 pass」
const skipped = (msg) => { skip++; console.log(`  · ${msg}`) }

/** 找到响应里的「行数组」（不同端点字段名不同） */
function rowsOf(json) {
  if (Array.isArray(json)) return json
  for (const k of ['deals', 'deal', 'token_deals', 'collections', 'collection', 'prompts', 'prompt', 'tags', 'keys']) {
    const v = json?.[k] ?? json?.data?.[k]
    if (v) return Array.isArray(v) ? v : [v]
  }
  return []
}

async function probe(label, path, opts = {}) {
  const res = await fetch(BASE + path)
  // ⚠️ 跳过 = **没测**，不是「没问题」。
  //
  // 上一版把 skip 和 pass 混在一起数，于是「prompts 详情」档因为 `rowsOf()` 不认识
  // `{ prompt }`（键名表里只有 `prompts`）一直走这里，探针显示「10 通过 / 0 失败」——
  // 假绿灯，掩盖了详情端点真实的 `deleted_at` 泄露。
  //
  // 现在：**取不到数据一律记失败**。想让某档跳过，必须显式传 `allowSkip: '理由'`，
  // 并在输出里用 `·` 标出来（不计入通过数，但也不算失败，便于「本就没数据」的端点）。
  if (res.status !== 200) {
    if (opts.allowSkip) { skipped(`${label}: 跳过（HTTP ${res.status}，${opts.allowSkip}）`); return }
    bad(`${label} 取数失败 HTTP ${res.status}（探针无法验证 = 不通过）`)
    return
  }
  const rows = rowsOf(await res.json())
  if (!rows.length) {
    if (opts.allowSkip) { skipped(`${label}: 跳过（空结果，${opts.allowSkip}）`); return }
    bad(`${label} 响应解析不出任何行（探针无法验证 = 不通过；若是端点返回结构变了，需更新 rowsOf 键名表）`)
    return
  }
  const keys = new Set(rows.flatMap(r => Object.keys(r || {})))

  for (const k of INTERNAL_KEYS) {
    if (opts.allowKeys?.includes(k)) continue
    if (keys.has(k)) bad(`${label} 泄露 ${k}`, JSON.stringify(rows[0][k]))
  }
  for (const k of EMPTY_ONLY) {
    if (!keys.has(k)) continue
    const leaked = rows.filter(r => r[k] !== '' && r[k] != null)
    if (leaked.length) bad(`${label} ${k} 非空`, JSON.stringify(leaked[0][k]))
    else ok(`${label} ${k} 恒为空串`)
  }
  for (const k of (opts.mustKeep || [])) {
    if (!keys.has(k)) bad(`${label} 缺字段 ${k}（脱敏过界？）`)
  }
  const clean = INTERNAL_KEYS.filter(k => keys.has(k) && !opts.allowKeys?.includes(k))
  if (!clean.length) ok(`${label}: ${rows.length} 条，无内部字段`)
}

/** HTML 页面：SSR payload 里不得出现内部键 */
async function probeHtml(label, path) {
  const res = await fetch(BASE + path)
  // 同上：页面取不到 = 没测 = 不算通过
  if (res.status !== 200) { bad(`${label} 取数失败 HTTP ${res.status}（探针无法验证 = 不通过）`); return }
  const html = await res.text()
  if (html.length < 500) { bad(`${label} 响应过短（${html.length} 字节），疑似异常页`); return }
  const hits = INTERNAL_KEYS.filter(k => html.includes(`"${k}"`))
  if (hits.length) bad(`${label} SSR payload 含 ${hits.join(',')}`)
  else ok(`${label}: SSR payload 无内部字段`)
}

async function main() {
  console.log(`▶ 目标：${BASE}\n`)

  // 取一条可见通告 id
  const list = await (await fetch(BASE + '/api/token-deals?limit=1')).json()
  const dealId = rowsOf(list)[0]?.id
  if (!dealId) { console.log('取不到通告 id，退出'); process.exit(1) }

  console.log('▶ token_deals 相关端点')
  // 列表只保留派生字段；note_html 仅详情下发（备注富文本要给编辑器/渲染用）
  await probe('列表(第1页)', '/api/token-deals?limit=5', { mustKeep: ['is_hidden', 'verified_at', 'reject_reason'] })
  await probe('列表(第2页)', '/api/token-deals?page=2&limit=5')
  await probe('列表(搜索)', '/api/token-deals?q=a&limit=3')
  await probe('详情', `/api/token-deals/${dealId}`, { mustKeep: ['is_deleted', 'is_invalid', 'invalid_reason_label', ...MUST_KEEP] })
  await probeHtml('详情页 SSR', `/tokens/${dealId}.html`)

  console.log('\n▶ 其它公开端点（user_id 目前恒为管理员 1，仍记录基线）')
  // 这三个端点确实下发 user_id：普通用户无法创建公开数据（POST 端强制），
  // 故当前 `user_id` 恒为 1，与同一响应里的 nickname「管理员」等价，无可利用路径。
  // 这里**记录基线**而不是判失败 —— 一旦将来开放「普通用户可公开发布」，
  // 这个探针会立刻把新的 user_id 值暴露出来。
  const allowed = ['user_id']
  await probe('collections 列表', '/api/collections?limit=3', { allowKeys: allowed })
  await probe('prompts 列表', '/api/prompts?limit=3', { allowKeys: allowed })
  // 详情端点同样 `SELECT *`：上一轮只修列表漏了详情，这里纳入矩阵
  const pl = await (await fetch(BASE + '/api/prompts?limit=1')).json()
  const pid = rowsOf(pl)[0]?.id
  if (pid) await probe('prompts 详情', `/api/prompts/${encodeURIComponent(pid)}`, { allowKeys: allowed })
  await probe('tags', '/api/tags', { allowKeys: allowed })
  await probe('token-keys', '/api/token-keys?limit=3', { allowKeys: allowed })

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败${skip ? ` / ${skip} 跳过（未验证）` : ''} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('执行异常:', e.message); process.exit(1) })
