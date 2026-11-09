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

// 「值里是否夹带密钥形态」必须用**真源**判定，不能在这儿另写一份正则：
// 1.0.80 的线上事故正是「拦的规则」和「脱敏的规则」漂移。与
// `category-source-check.mjs` 同一做法（Node 24 原生剥类型，直接 import .ts）。
const { containsKeyLike, redactKeyLike } = await import('../utils/key-redact.ts')

/**
 * 命中密钥形态时该打印什么：**先脱敏再截窗**，绝不把明文 Key 打进控制台/CI 日志
 * （`favshub-data-ops` 协议里「取到后不要写入日志」是同一条纪律）。
 * 用「原文与脱敏文第一处差异」定位命中位置，再取一个以掩码为中心的窗口。
 */
function maskedPeek(text, radius = 44) {
  const s = String(text ?? '')
  const masked = redactKeyLike(s)
  if (masked === s) return ''
  let i = 0
  while (i < s.length && s[i] === masked[i]) i++
  return masked.slice(Math.max(0, i - 10), i + radius)
}

// 绝不能出现在公开响应里的键（键不出现，或值必须为空）
// 2026-11-04：新增 `source_url`（情报来源，运营留痕）。它是 `token_deals` 的第 6 个
// 内部列，写入口只有导入脚本直连 DB —— 但公开端点用 `{ ...row }` 展开全列，
// 每加一个内部列都必须回到列表**和**详情两处显式剔除。这个探针就是那两处的回归网。
// 特别地：库里 116 条导入行**确实有这个值**，所以「字段有值但不下发」是可验证的强断言。
//
// ⚠️ 2026-11-09 更正（本轮差点把它当泄露去修）：`source_url` 是**两张表的同名字段，语义相反**：
//   - `token_deals.source_url` = 情报来源留痕，公开侧永不下发（上面这条守的就是它）；
//   - `token_keys.source_url`  = 原帖地址，是 `GET /api/token-keys` **对外契约里的公开字段**
//     （`favshub-data-ops/SKILL.md` 的 18 字段白名单；1.0.80 那次修的是「遮蔽值里的 key 形态串」，
//     作者意图是**保留字段**，不是删掉它）。
// 于是自 1.0.72 把它列进本清单起，`token-keys` 端点与 Key 页这两档**恒为失败**
// （本轮实测：29 行里 0 行值含密钥形态、页面可见文本零命中、只有 payload 里有键名）。
// 一条长期挂红的断言会训练人忽略整个脚本的输出 —— 比少一档探针更危险。
//
// 修法**不是**把它从 `INTERNAL_KEYS` 删掉、也不是加全局 `allowKeys` —— 那两招都会顺手
// 把 `token_deals` 那条真探测器弄瞎（未来 `...row` 展开全列重新漏出它时，探针沉默）。
// 正确做法：**豁免按端点生效** —— 只有确实把它当公开契约的端点才传 `publicFields`，
// 而且豁免的只是「键名不得出现」这一条；这些端点仍逐值检查密钥形态，并要求键必须在
// （谁把字段从出口白名单删掉，归因链会断，这里立刻报）。
const PUBLIC_FIELDS = ['source_url']
const INTERNAL_KEYS = ['deleted_at', 'invalid_reason', 'deleted_by', 'user_id', 'guest_fingerprint', 'source_url']
// 键保留但值必须为空串的例外
const EMPTY_ONLY = ['verified_by']
// 前端依赖、脱敏时必须保留的字段（防「脱敏过界」）
// 2026-11-04 新增的结构化字段：summary / limits / requirements / verify_scope / faq / featured
// 都是**公开**字段（其中 limits / requirements 另有服务端渲染的 *_html 副本）。
// ⚠️ 若拿本脚本探**早于 2026-11-04 的部署**（例如尚未升级的生产），这些 mustKeep 会如实报缺失 ——
//    那不是回归，是版本差；升级后复跑即转绿。
const MUST_KEEP = ['verified_at', 'note_html', 'reject_reason']  // 仅 token_deals 适用
/** 2026-11-04 结构化字段：列表与详情都应下发 */
const MUST_KEEP_STRUCTURED = ['summary', 'limits', 'requirements', 'verify_scope', 'faq', 'featured']
/** 仅详情下发（服务端渲染后的 HTML 副本） */
const MUST_KEEP_STRUCTURED_HTML = ['limits_html', 'requirements_html']

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

  for (const k of internalKeyNames(opts)) {
    if (keys.has(k)) bad(`${label} 泄露 ${k}`, redactKeyLike(JSON.stringify(rows[0][k])))
  }
  // 本端点的公开契约字段：键**必须在**（删了就断归因链），值里**绝不得有**密钥形态。
  for (const k of (opts.publicFields || [])) {
    if (!PUBLIC_FIELDS.includes(k)) bad(`${label} publicFields 写了清单外的 ${k}（先确认它真是对外契约字段）`)
    if (!keys.has(k)) { bad(`${label} 缺公开字段 ${k}（出口白名单被删？前端归因链会断）`); continue }
    const hits = rows.filter(r => containsKeyLike(r?.[k]))
    if (hits.length) bad(`${label} 公开字段 ${k} 值含密钥形态`, maskedPeek(hits[0][k]))
    else ok(`${label} 公开字段 ${k}：${rows.length} 条值均无密钥形态`)
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
  const clean = internalKeyNames(opts).filter(k => keys.has(k))
  if (!clean.length) ok(`${label}: ${rows.length} 条，无内部字段`)
}

/**
 * HTML 页面：**两层**检查
 *
 *  1. SSR payload（`__NUXT_DATA__` 里的 JSON）不得出现内部键 —— 抓「数据下发了」；
 *  2. **可见文本**不得出现内部词 —— 抓「渲染出来了」。
 *
 * 为什么必须分两层：只查 `"key"` 这种 JSON 形式时，若有人把 `deleted_at` 渲染成
 * 页面上的一行字，payload 里可能已经没有该键（被组件取用后不再留存），探针就瞎了。
 * 反之只查可见文本也抓不到「数据下发了但前端没渲染」—— 而 F12 一开就能看见。
 * 两种泄露面都要堵。
 */
/**
 * 某档探针实际要守的「内部键名」：从 `INTERNAL_KEYS` 里扣掉**本端点**声明为公开契约的
 * 字段（`opts.publicFields`）与显式豁免（`opts.allowKeys`）。
 *
 * 关键是**按端点**扣，不是全局扣：`source_url` 对 `/api/token-keys` 是契约字段，
 * 对 `/api/token-deals` 仍是「公开侧永不下发」的内部列。全局豁免会让后者变瞎 ——
 * 那正是 1.0.72 立这条断言要防的「`...row` 展开全列把它重新漏出去」。
 * 值的风险与键名无关，由 `containsKeyLike` 逐值兜住，不受这里影响。
 */
const internalKeyNames = (opts = {}) =>
  INTERNAL_KEYS.filter(k => !opts.publicFields?.includes(k) && !opts.allowKeys?.includes(k))

async function probeHtml(label, path, opts = {}) {
  const res = await fetch(BASE + path)
  // 同上：页面取不到 = 没测 = 不算通过
  if (res.status !== 200) { bad(`${label} 取数失败 HTTP ${res.status}（探针无法验证 = 不通过）`); return }
  const html = await res.text()
  if (html.length < 500) { bad(`${label} 响应过短（${html.length} 字节），疑似异常页`); return }

  // 层 1：SSR payload
  //
  // ⚠️ 不能简单地搜 `"user_id":<数字>` —— Nuxt 3 的 `__NUXT_DATA__` 是**索引表压缩格式**：
  // 对象写成 `{"id":17,"user_id":18,...}`，冒号后的数字是**数组下标**而不是真实值。
  // 我第一版就踩了这个坑：`/collections` 页面报 `user_id` 泄露，实际解析出来值是 `1`（管理员），
  // 那个 `18` 只是 `p[18]` 的下标。误报和漏报一样有害 —— 会让人去修不存在的问题。
  //
  // 正确做法：把 payload 当真 JSON 读出来，按索引还原，再检查**还原后的对象键**。
  const payloadHits = []
  try {
    const m = html.match(/__NUXT_DATA__[^>]*>([\s\S]*?)<\/script>/)
    if (m) {
      const table = JSON.parse(m[1])
      const seen = new Set()
      const resolve = (i) => {
        if (typeof i !== 'number') return i
        if (seen.has(i)) return null
        seen.add(i)
        const v = table[i]
        if (Array.isArray(v)) return v.map(resolve)
        if (v && typeof v === 'object') {
          const o = {}
          for (const [k, x] of Object.entries(v)) o[k] = resolve(x)
          return o
        }
        return v
      }
      // 遍历还原后的每个对象，收集其键名；顺带对「公开字段」的**值**做密钥形态检查
      const keys = new Set()
      const publicHits = []
      const walk = (node, depth = 0) => {
        if (!node || depth > 12) return
        if (Array.isArray(node)) { node.forEach(n => walk(n, depth + 1)); return }
        if (typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) {
            keys.add(k)
            if (opts.publicFields?.includes(k) && typeof v === 'string' && containsKeyLike(v)) {
              publicHits.push(`${k}→${maskedPeek(v)}`)
            }
            walk(v, depth + 1)
          }
        }
      }
      walk(resolve(0))
      walk(table.map((_, i) => resolve(i)))
      for (const k of internalKeyNames(opts)) { if (keys.has(k)) payloadHits.push(k) }
      if (publicHits.length) bad(`${label} SSR payload 的公开字段值含密钥形态`, publicHits[0])
    } else {
      // 没有 payload（非 SSR 页或格式变了）—— 退回字符串探测，并标注方法
      for (const k of internalKeyNames(opts)) { if (html.includes(`"${k}"`)) payloadHits.push(k) }
    }
  } catch {
    // 解析失败时保守退回字符串探测（宁可误报也不漏报），并在输出里注明
    for (const k of internalKeyNames(opts)) { if (html.includes(`"${k}"`)) payloadHits.push(k) }
  }
  if (payloadHits.length) bad(`${label} SSR payload 含 ${payloadHits.join(',')}`)

  // 层 2：可见文本（剥掉 script / style / 标签后剩下的字）
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
  // 内部词 + 已知管理员用户名（用户名绝不能出现在前端，CLAUDE.md 既有口径）
  const VISIBLE_NEEDLES = [...internalKeyNames(opts), 'admin_favs']
  const visibleHits = VISIBLE_NEEDLES.filter(n => visible.includes(n))
  if (visibleHits.length) bad(`${label} 可见文本含内部词 ${visibleHits.join(',')}`)
  // 「页面上有没有明文密钥」不在这里查：那条不变量由 `public-secret-scan.mjs` 统一覆盖
  // 全部端点（含本文件所有页面档）。在这儿再查一遍只会因为提示词页**正文含示例 Key**
  // 而误报 —— 那是产品内容不是泄露。一个不变量只留一个守门人。

  if (!payloadHits.length && !visibleHits.length) {
    ok(`${label}: SSR payload 与可见文本均无内部字段`)
  }
}

async function main() {
  console.log(`▶ 目标：${BASE}\n`)

  // 取一条可见通告 id
  const list = await (await fetch(BASE + '/api/token-deals?limit=1')).json()
  const dealId = rowsOf(list)[0]?.id
  if (!dealId) { console.log('取不到通告 id，退出'); process.exit(1) }

  console.log('▶ token_deals 相关端点')
  // 列表只保留派生字段；note_html 仅详情下发（备注富文本要给编辑器/渲染用）
  await probe('列表(第1页)', '/api/token-deals?limit=5', { mustKeep: ['is_hidden', 'verified_at', 'reject_reason', ...MUST_KEEP_STRUCTURED] })
  await probe('列表(第2页)', '/api/token-deals?page=2&limit=5')
  await probe('列表(搜索)', '/api/token-deals?q=a&limit=3')
  await probe('详情', `/api/token-deals/${dealId}`, { mustKeep: ['is_deleted', 'is_invalid', 'invalid_reason_label', ...MUST_KEEP, ...MUST_KEEP_STRUCTURED, ...MUST_KEEP_STRUCTURED_HTML] })
  await probeHtml('详情页 SSR', `/tokens/${dealId}.html`)
  // 再抽两条不同类型的通告页（有码池 / 无 call_url），避免「恰好那一条干净」
  for (const q of ['/api/token-deals?limit=30']) {
    const more = rowsOf(await (await fetch(BASE + q)).json())
    for (const d of more.slice(0, 3)) {
      if (d.id && d.id !== dealId) await probeHtml(`详情页 SSR(${d.id.slice(-6)})`, `/tokens/${d.id}.html`)
    }
  }
  // 列表页与其它公开页面：可见文本同样不得出现内部词
  //
  // `Key 页` 必须显式声明 `publicFields`：`token_keys.source_url`（原帖地址）是它的
  // 对外契约字段，payload 里有这个键是**预期**。不传就会退回去按「内部键」判它泄露 ——
  // 那正是 1.0.72 起恒挂红两档的成因。反过来 `/tokens`（通告列表页）**不传**：
  // 那里的 `source_url` 是 `token_deals` 的内部列，出现即泄露，这条断言必须继续有效。
  for (const [l, p, o] of [['列表页', '/tokens'], ['提示词页', '/prompts'], ['Key 页', '/tokens/keys', { publicFields: PUBLIC_FIELDS }]]) {
    await probeHtml(l, p, o || {})
  }
  // 精选集页：`collections` 端点本来就下发 `user_id`（基线已知项，实测还原后值恒为
  // 管理员 1 或 null —— 公开精选集的作者必然是管理员，POST 端点强制）。
  // 这里显式 allowKeys 而不是从 INTERNAL_KEYS 里删掉它：留着才能在未来真的泄露时报警。
  await probeHtml('精选集页', '/collections', { allowKeys: ['user_id'] })

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
  // 2026-11-04：开发/新部署的库里 `token_keys` 常常是**空表**（福利 Key 靠用户上报累积）。
  // 空表时 `rowsOf()` 返回 []，探针会记失败 —— 但它其实「没东西可测」，不是泄露。
  // 用显式 `allowSkip` 说明理由（而不是放宽全局规则）：跳过仍然是**跳过**，
  // 不计入通过数、在汇总里单独计数，绝不会冒充「验过了」。
  //
  // 为什么必须处理：一条长期以失败态存在的断言会训练人忽略这个脚本的输出 ——
  // 那比少一条探针更危险（`be` 指出）。
  await probe('token-keys', '/api/token-keys?limit=3', { allowKeys: allowed, publicFields: PUBLIC_FIELDS, allowSkip: 'Key 表可能为空，无行可验' })

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败${skip ? ` / ${skip} 跳过（未验证）` : ''} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('执行异常:', e.message); process.exit(1) })
