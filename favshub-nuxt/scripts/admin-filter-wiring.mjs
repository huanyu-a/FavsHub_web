/**
 * 后台筛选栏「模板 ↔ 状态 ↔ 请求参数 ↔ 服务端白名单」接线守卫（2026-11-09）
 *
 * ## 为什么需要这个套件
 *
 * 独立审查指出：`pages/admin/token-deals.vue` 里「控件接到哪个状态、状态又拼成哪个参数」
 * 这一层**没有任何测试**，只在上一轮把「参数构造」抽成纯函数后才补上了那半截
 * （`scripts/admin-filter-params.mjs`）。剩下这半截仍然裸着 —— 而它有一类
 * **不报错、只静默失效**的坏法：
 *
 *   1. `v-model="dealsCatgory"`（拼错一个字母）→ Vue 会把它当成一个**新变量**，
 *      下拉框照样能选、界面毫无异常，但它**根本没进筛选状态**，列表永远不动。
 *      表现与「后端没实现这个筛选」一模一样。
 *   2. 下拉选项**手抄**在模板里（`<option value="guest">`）→ 与服务端白名单各存一份。
 *      服务端加一档，界面就少一档（筛不出来）；界面改个词，服务端 `pickEnum` 认不出
 *      （降级成「不筛」，同样静默）。
 *   3. 状态变量接进了模板，却没被喂进参数构造器 → 同上，选了没反应。
 *
 * 本套件把这三条都钉住，并且**四条链一起对账**：
 *
 *   模板控件 ──v-model──▶ 脚本状态 ──▶ 该视图的 filterState 对象 ──▶ ADMIN_DEAL_FILTER_FIELDS
 *                                                                        │
 *                                                        服务端 query.<param> + pickEnum 白名单
 *
 * ## 反真空
 *
 * 全是「断言不存在」的话，把筛选栏整段删掉就会全部通过。故先钉死每条链上
 * **应该有多少个东西**（几个下拉、几个 input、声明了多少标识符），
 * 少一个就报红；再断言「不许有什么」。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

let pass = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const vueSrc = readFileSync(join(ROOT, 'pages', 'admin', 'token-deals.vue'), 'utf8')
const tplStart = vueSrc.indexOf('<template>')
// ⚠️ 必须用 **lastIndexOf**：模板里有嵌套的 `<template v-if=...>`（表格单元格里就有一处），
// 用 `indexOf('</template>')` 会把模板在第 237 行处截断，于是「全部」卡片根本没进解析范围 ——
// 而断言会以「分区切不出来」的形式报错。第一版就是这么错的。
const tplEnd = vueSrc.lastIndexOf('</template>')
const scriptStart = vueSrc.indexOf('<script setup')
const scriptEnd = vueSrc.indexOf('</script>', scriptStart)
const tpl = vueSrc.slice(tplStart, tplEnd)
const script = vueSrc.slice(scriptStart, scriptEnd)

console.log('▶ ① 解析前置：三个分区的模板与脚本块都取到了')
{
  check('取到 template 块', tpl.length > 5000, `${tpl.length} 字节`)
  check('取到 script setup 块', script.length > 5000, `${script.length} 字节`)
}

// ── 卡片区间：按 `v-else-if="tab === 'X'"` 切分出 edits / invalid / deals 三段 ──
const cardMarks = []
// 注意「修改建议」那一张用的是 `v-if`（它是 tab 链的第一支），其余是 `v-else-if` —— 两者都要匹配。
for (const m of tpl.matchAll(/<div\s+v-(?:else-)?if="tab === '([a-z]+)'"/g)) {
  cardMarks.push({ tab: m[1], at: m.index })
}
cardMarks.sort((a, b) => a.at - b.at)
const cardRange = {}
cardMarks.forEach((c, i) => {
  cardRange[c.tab] = [c.at, i + 1 < cardMarks.length ? cardMarks[i + 1].at : tpl.length]
})

console.log('\n▶ ② 反真空：三个分区与其中的控件数量符合预期')
{
  check('切出 edits / invalid / deals 三个卡片区间',
    cardRange.edits && cardRange.invalid && cardRange.deals,
    cardMarks.map(c => c.tab).join(','))

  const controlsIn = tab => {
    const [a, b] = cardRange[tab]
    const seg = tpl.slice(a, b)
    const selects = [...seg.matchAll(/<select\b[\s\S]*?<\/select>/g)].map(m => ({ html: m[0], at: a + m.index }))
    const inputs = [...seg.matchAll(/<input\b[^>]*>/g)].map(m => ({ html: m[0], at: a + m.index }))
    return { seg, selects, inputs }
  }
  const deals = controlsIn('deals')
  const invalid = controlsIn('invalid')
  const edits = controlsIn('edits')

  check('「全部/队列」卡片里有 5 个下拉（分类/品级/地区/来源/发布者）',
    deals.selects.length === 5, `实际 ${deals.selects.length}`)
  check('「全部/队列」卡片里有 1 个关键词输入框',
    deals.inputs.length === 1, `实际 ${deals.inputs.length}`)
  check('「已失效」卡片里有 6 个下拉（多一个「失效原因」）',
    invalid.selects.length === 6, `实际 ${invalid.selects.length}`)
  check('「已失效」卡片里有 1 个关键词输入框',
    invalid.inputs.length === 1, `实际 ${invalid.inputs.length}`)
  check('「修改建议」卡片里没有任何下拉（它不该有筛选栏）',
    edits.selects.length === 0, `实际 ${edits.selects.length}`)
  check('筛选栏 .filter-bar 恰好出现 2 次（队列侧 + 已失效侧）',
    (tpl.match(/class="filter-bar/g) || []).length === 2,
    String((tpl.match(/class="filter-bar/g) || []).length))

  // 供后续小节使用
  globalThis.__deals = deals
  globalThis.__invalid = invalid
}

// ── 脚本里声明的顶层标识符 ──
const declared = new Set()
for (const m of script.matchAll(/(?:^|\n)\s*(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/g)) {
  declared.add(m[1])
}
for (const m of script.matchAll(/(?:^|\n)\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)) {
  declared.add(m[1])
}

console.log('\n▶ ③ v-model / 事件处理函数指向的标识符必须真的存在')
{
  check('解析到足够多的脚本标识符（避免脚本块没解析到而假绿）',
    declared.size > 80, `${declared.size} 个`)

  const modelTargets = []
  const handlers = []
  for (const tab of ['deals', 'invalid']) {
    const { selects, inputs } = globalThis['__' + tab]
    for (const c of [...selects, ...inputs]) {
      const mv = /v-model="([^"]+)"/.exec(c.html)
      if (mv) modelTargets.push({ tab, name: mv[1] })
      for (const h of c.html.matchAll(/@(?:change|input|keyup\.enter)="([A-Za-z_$][\w$]*)"/g)) {
        handlers.push({ tab, name: h[1] })
      }
    }
  }

  const badModels = modelTargets.filter(t => !declared.has(t.name))
  check(`全部 ${modelTargets.length} 个 v-model 目标都在脚本里有声明`,
    badModels.length === 0, badModels.map(t => `${t.tab}:${t.name}`).join('、'))
  check('v-model 数量与控件数一致（6 + 7 = 13，没有漏解析）',
    modelTargets.length === 13, `实际 ${modelTargets.length}`)

  const badHandlers = handlers.filter(h => !declared.has(h.name))
  check(`全部 ${handlers.length} 个事件处理函数都在脚本里有声明`,
    badHandlers.length === 0, badHandlers.map(h => `${h.tab}:${h.name}`).join('、'))
  check('事件处理函数数量符合预期（11 个 @change + 2 个 @input + 2 个 @keyup.enter = 15）',
    handlers.length === 15, `实际 ${handlers.length}`)

  // 「重置」按钮同样要接真函数（它不在 select/input 里，单独查）
  for (const [label, fn, comp] of [
    ['队列侧', 'resetDealsFilters', 'canResetDealsFilters'],
    ['已失效侧', 'resetInvalidFilters', 'canResetInvalidFilters'],
  ]) {
    check(`${label}「重置」按钮接的是已声明的函数与其可用性 computed`,
      declared.has(fn) && declared.has(comp)
      && new RegExp(`@click="${fn}"`).test(tpl)
      && new RegExp(`:disabled="!${comp}"`).test(tpl),
      `${fn} / ${comp}`)
  }
}

console.log('\n▶ ④ 下拉选项只许来自共享真源（不许手抄值）')
{
  // 允许的共享选项表 —— 全部来自 utils/ 下的单一真源模块
  const SHARED_TABLES = new Set([
    'CATEGORY_OPTIONS', 'QUALITY_LEVELS', 'REGION_OPTIONS', 'SOURCE_OPTIONS',
    'INVALID_REASON_OPTIONS', 'ORIGIN_OPTIONS',
  ])
  const badInline = []
  const badTable = []
  const seenTables = new Set()
  for (const tab of ['deals', 'invalid']) {
    for (const c of globalThis['__' + tab].selects) {
      const title = (/title="([^"]*)"/.exec(c.html) || [, '?'])[1]
      // 字面 option：只允许「空值 = 不筛」那一项
      for (const o of c.html.matchAll(/<option value="([^"]*)"/g)) {
        if (o[1] !== '') badInline.push(`${tab}/${title} → value="${o[1]}"`)
      }
      // 必须恰好有一个 v-for 取自共享表
      const vfor = [...c.html.matchAll(/v-for="\w+ in ([A-Za-z_$][\w$]*)"/g)].map(m => m[1])
      if (vfor.length !== 1) badTable.push(`${tab}/${title} → v-for 数量 ${vfor.length}`)
      else {
        seenTables.add(vfor[0])
        if (!SHARED_TABLES.has(vfor[0])) badTable.push(`${tab}/${title} → ${vfor[0]} 不是共享表`)
      }
    }
  }
  check('筛选栏里没有任何手写的非空 option（手抄值必然会与服务端白名单漂移）',
    badInline.length === 0, badInline.join('、'))
  check('每个下拉都恰好有一处 v-for 取自共享选项表',
    badTable.length === 0, badTable.join('、'))
  check('用到 6 张不同的共享表（分类/品级/地区/来源/失效原因/发布者）',
    seenTables.size === 6, [...seenTables].join(','))
}

console.log('\n▶ ⑤ 状态变量必须被喂进该视图的筛选状态对象，且 key 合法')
{
  const fieldsMod = await import(join(ROOT, 'utils', 'admin-deal-filters.ts'))
  const validKeys = new Set(fieldsMod.ADMIN_DEAL_FILTER_FIELDS.map(f => f.key))

  for (const [tab, stateName, modelPrefix] of [
    ['deals', 'dealsFilterState', 'deals'],
    ['invalid', 'invalidFilterState', 'invalid'],
  ]) {
    const re = new RegExp(`const ${stateName}\\s*=\\s*computed<[^>]*>\\(\\(\\)\\s*=>\\s*\\(\\{([\\s\\S]*?)\\}\\)\\)`)
    const m = re.exec(script)
    check(`找到 ${stateName} 的对象字面量`, !!m)
    if (!m) continue
    const body = m[1]
    const pairs = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\.value/g)]
      .map(p => ({ key: p[1], src: p[2] }))

    check(`${stateName} 解析到 ${tab === 'deals' ? 6 : 7} 个字段`,
      pairs.length === (tab === 'deals' ? 6 : 7), `实际 ${pairs.length}`)

    const badKeys = pairs.filter(p => !validKeys.has(p.key))
    check(`${stateName} 的每个 key 都在 ADMIN_DEAL_FILTER_FIELDS 里`,
      badKeys.length === 0, badKeys.map(p => p.key).join('、'))

    // 模板里 v-model 的目标必须都出现在这个对象的值里 —— 否则「选了没反应」
    const wired = new Set(pairs.map(p => p.src))
    const models = [...globalThis['__' + tab].selects, ...globalThis['__' + tab].inputs]
      .map(c => (/v-model="([^"]+)"/.exec(c.html) || [])[1])
      .filter(Boolean)
    const unwired = models.filter(x => !wired.has(x))
    check(`「${tab}」筛选栏的每个控件都被喂进了参数构造器（没有「选了没反应」的控件）`,
      unwired.length === 0, unwired.join('、'))

    const searchTarget = tab === 'deals' ? 'searchQuery' : 'invalidSearch'
    check(`关键词输入框（${searchTarget}）也在其中`, wired.has(searchTarget), [...wired].join(','))
    void modelPrefix
  }
}

console.log('\n▶ ⑥ 语义：失效原因只属于「已失效」（队列里没有这个概念）')
{
  const invalidHasReason = globalThis.__invalid.selects.some(c => /v-model="invalidReason"/.test(c.html))
  const dealsHasReason = globalThis.__deals.selects.some(c => /v-model="[^"]*[Rr]eason/.test(c.html))
  check('「已失效」栏有「失效原因」下拉', invalidHasReason)
  check('「全部/队列」栏**没有**「失效原因」下拉', !dealsHasReason)
  const reasonSelect = globalThis.__invalid.selects.find(c => /v-model="invalidReason"/.test(c.html))
  check('「失效原因」下拉的选项也来自共享表 INVALID_REASON_OPTIONS',
    !!reasonSelect && /v-for="\w+ in INVALID_REASON_OPTIONS"/.test(reasonSelect.html))
}

console.log('\n▶ ⑦ 共享选项表 ↔ 服务端白名单：值集必须双向相等')
{
  const F = await import(join(ROOT, 'utils', 'deal-fields.ts'))
  const C = await import(join(ROOT, 'utils', 'deal-categories.ts'))
  const R = await import(join(ROOT, 'utils', 'deal-invalid-reasons.ts'))

  const sameSet = (a, b) => {
    const A = new Set(a), B = new Set(b)
    return A.size === B.size && [...A].every(x => B.has(x))
  }
  const cases = [
    ['地区', F.REGION_OPTIONS.map(o => o.value), F.REGIONS],
    ['来源', F.SOURCE_OPTIONS.map(o => o.value), F.SOURCE_TAGS],
    ['分类', C.DEAL_CATEGORY_OPTIONS.map(o => o.value), C.DEAL_CATEGORIES],
    ['失效原因', R.INVALID_REASON_OPTIONS.map(o => o.value), Object.keys(R.INVALID_REASON_LABELS)],
    ['发布者类型', F.ORIGIN_OPTIONS.map(o => o.value), F.ORIGIN_FILTERS],
  ]
  for (const [label, opts, whitelist] of cases) {
    check(`${label}：下拉值集 == 服务端白名单（非空）`,
      opts.length > 0 && whitelist.length > 0 && sameSet(opts, whitelist),
      `下拉=[${opts}] 白名单=[${whitelist}]`)
  }
  check('品级下拉直接用白名单本身（QUALITY_LEVELS），不存在第二份',
    F.QUALITY_LEVELS.length > 0 && new Set(F.QUALITY_LEVELS).size === F.QUALITY_LEVELS.length,
    String(F.QUALITY_LEVELS.length))
}

console.log('\n▶ ⑧ 服务端侧：六个参数都经 pickEnum 读取（非法值降级为「不筛」而非 500）')
{
  const raw = readFileSync(join(ROOT, 'server', 'api', 'admin', 'token-deals', 'index.get.ts'), 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const params = ['category', 'quality', 'region', 'source_tag', 'invalid_reason', 'origin']
  for (const p of params) {
    check(`服务端用 pickEnum 读取 query.${p}`,
      new RegExp(`pickEnum\\(query\\.${p}(?![A-Za-z0-9_])`).test(src))
  }
  // 发布者白名单已收敛到共享真源（原先写在路由文件里，是第二份副本）
  check('路由文件里不再有本地的 ORIGIN_FILTERS 常量（已收敛到 utils/deal-fields.ts）',
    !/const\s+ORIGIN_FILTERS\s*=/.test(src))
  check('路由文件从共享模块 import ORIGIN_FILTERS',
    /ORIGIN_FILTERS[\s\S]{0,400}?from '/.test(src) || /import \{[\s\S]*?ORIGIN_FILTERS[\s\S]*?\} from/.test(raw))
}

console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
if (fails.length) {
  console.log('失败项：')
  for (const f of fails) console.log('  - ' + f)
}
process.exit(fails.length ? 1 : 0)
