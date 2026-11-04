#!/usr/bin/env node
/**
 * category-source-check.mjs — 断言「通告分类」只有一个真源，且真源本身正确
 *
 * ## 为什么需要这个套件
 *
 * 「通告分类」枚举原先散在 **8 处**（服务端校验、卡片徽标、详情页徽标、编辑器下拉、
 * 筛选栏下拉、后台列表标签、首页导航卡、sitemap 路由），每加一个分类都要手改 8 个地方。
 * 这不是理论风险，是**已经发生过多次的实伤**：
 *
 *   - `client` 漏在首页导航卡与 sitemap —— 4 条客户端额度通告在首页没有任何入口，
 *     也没有可被搜索引擎收录的落地页；
 *   - `domain` 在后台被显示成「API 额度」—— 审核的人分不清是域名还是模型额度；
 *   - `domain` 漏在 QQ 推送的分类行 —— 域名通告的推送里根本不显示分类（本次修复时发现）；
 *   - `domain` 新增后 `TokenDealCard` 徽标不显示（徽标表是按分类手列的）。
 *
 * 所以本套件做两件事：
 *   1. **真源自检** —— 派生出来的表（选项 / 卡片 / 路由 / 标签）必须与 `DEAL_CATEGORIES`
 *      的取值与顺序一致，且历史踩过的具体值（如 domain 的中文标签）必须正确；
 *   2. **防漂移守卫** —— 除真源外，任何文件都不得再出现「≥3 个分类字面量」的数组/映射。
 *      再抄一份就变红，而不是等上线后由用户发现某处少了一个分类。
 *
 * 运行：node --experimental-strip-types scripts/category-source-check.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

let pass = 0
let fail = 0
function check(name, actual, expected) {
  if (actual === expected) pass++
  else { fail++; console.error(`✗ ${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`) }
}
function ok(name, cond, detail = '') {
  if (cond) pass++
  else { fail++; console.error(`✗ ${name}${detail ? '\n    ' + detail : ''}`) }
}

const {
  DEAL_CATEGORIES, DEAL_CATEGORY_LABELS, DEAL_CATEGORY_SHORT_LABELS,
  DEAL_CATEGORY_OPTIONS, DEAL_CATEGORY_CARDS, DEAL_CATEGORY_ROUTES, dealCategoryMeta,
} = await import('../utils/deal-categories.ts')

/** 真源文件（守卫豁免它自己） */
const SOURCE_FILE = 'utils/deal-categories.ts'
/** 分类字面量 —— 出现在同一个文件里的**不同**取值达到阈值即视为又一份副本 */
const CATEGORY_LITERALS = ["'token'", "'cloud'", "'domain'", "'client'"]
const DUPLICATE_THRESHOLD = 3

// ── 1. 真源取值与顺序 ───────────────────────────────────────────────
console.log('▶ 真源取值与顺序')
check('DEAL_CATEGORIES 四个分类且顺序固定',
  JSON.stringify([...DEAL_CATEGORIES]), JSON.stringify(['token', 'cloud', 'domain', 'client']))

// ── 2. 派生表必须与真源同源同序 ─────────────────────────────────────
console.log('\n▶ 派生表与真源一致（同源同序）')
check('下拉选项数量与真源一致', DEAL_CATEGORY_OPTIONS.length, DEAL_CATEGORIES.length)
check('下拉选项取值与真源同序',
  JSON.stringify(DEAL_CATEGORY_OPTIONS.map(o => o.value)), JSON.stringify([...DEAL_CATEGORIES]))
check('导航卡数量与真源一致', DEAL_CATEGORY_CARDS.length, DEAL_CATEGORIES.length)
check('导航卡取值与真源同序',
  JSON.stringify(DEAL_CATEGORY_CARDS.map(c => c.value)), JSON.stringify([...DEAL_CATEGORIES]))
check('导航卡保留 category 别名（消费方按此取值）',
  JSON.stringify(DEAL_CATEGORY_CARDS.map(c => c.category)), JSON.stringify([...DEAL_CATEGORIES]))
check('标签表覆盖全部分类',
  DEAL_CATEGORIES.every(c => Boolean(DEAL_CATEGORY_LABELS[c])), true)
check('短标签表覆盖全部分类',
  DEAL_CATEGORIES.every(c => Boolean(DEAL_CATEGORY_SHORT_LABELS[c])), true)
ok('sitemap 路由不重复', new Set(DEAL_CATEGORY_ROUTES).size === DEAL_CATEGORY_ROUTES.length)
check('sitemap 路由数量与真源一致', DEAL_CATEGORY_ROUTES.length, DEAL_CATEGORIES.length)

// ── 3. 历史踩过的具体值（回归锚点）───────────────────────────────────
// 这几条都是**真实事故**的锚点，不是形式检查：改动标签文案时读到失败信息就知道踩了哪个坑。
console.log('\n▶ 历史事故回归锚点')
check('domain 的标签是「免费域名」（曾在后台显示成「API 额度」）',
  dealCategoryMeta('domain').label, '免费域名')
check('domain 的短标签是「免费域名」', dealCategoryMeta('domain').shortLabel, '免费域名')
check('cloud 的短标签是「云服务器」（后台窄徽标用）',
  dealCategoryMeta('cloud').shortLabel, '云服务器')
check('cloud 的完整标签是「免费云服务器」', dealCategoryMeta('cloud').label, '免费云服务器')
check('domain 有独立落地页路由（曾漏在 sitemap 与首页导航卡）',
  dealCategoryMeta('domain').route, '/tokens/domain')
check('client 有独立落地页路由（曾漏在 sitemap 与首页导航卡）',
  dealCategoryMeta('client').route, '/tokens/client')
check('client 的 QQ 推送标签可用（曾漏在 qq-notify 的手写 if 链里）',
  dealCategoryMeta('client').label, '客户端额度')

// ── 4. 回落语义 ─────────────────────────────────────────────────────
console.log('\n▶ 未知名回落口径')
check('未知分类回落 token', dealCategoryMeta('不存在的分类').value, 'token')
check('undefined 回落 token', dealCategoryMeta(undefined).value, 'token')
check('null 回落 token', dealCategoryMeta(null).value, 'token')

// ── 5. 徽标显示口径（卡片不许给默认分类挂标）────────────────────────
console.log('\n▶ 徽标显示口径')
check('token 不挂徽标（默认分类，挂标纯噪音）', dealCategoryMeta('token').showBadge, false)
check('cloud 挂徽标', dealCategoryMeta('cloud').showBadge, true)
check('domain 挂徽标', dealCategoryMeta('domain').showBadge, true)
check('client 挂徽标', dealCategoryMeta('client').showBadge, true)

// ── 6. 防漂移守卫：除真源外不得再有分类字面量副本 ────────────────────
console.log('\n▶ 防漂移守卫（除真源外不得再手抄分类清单）')
const SCAN_ROOTS = ['server', 'components', 'pages', 'utils', 'composables', 'layouts', 'middleware', 'plugins']
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', 'data', 'public', 'assets'])
const offenders = []

function walk(dir) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) { walk(full); continue }
    if (!/\.(ts|vue|mjs|js)$/.test(name)) continue
    const rel = relative(ROOT, full).split('\\').join('/')
    if (rel === SOURCE_FILE) continue
    let text
    try { text = readFileSync(full, 'utf8') } catch { continue }
    const present = CATEGORY_LITERALS.filter(lit => text.includes(lit))
    if (present.length >= DUPLICATE_THRESHOLD) offenders.push(`${rel}（${present.length} 个：${present.join(' ')}）`)
  }
}
for (const r of SCAN_ROOTS) walk(join(ROOT, r))

/** 列出全部可扫描源的相对路径（供后面的枚举副本检查复用） */
function walkAll() {
  const out = []
  const seen = new Set()
  const go = (dir) => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) { go(full); continue }
      if (!/\.(ts|vue|mjs|js)$/.test(name)) continue
      const rel = relative(ROOT, full).split('\\').join('/')
      if (seen.has(rel)) continue
      seen.add(rel); out.push(rel)
    }
  }
  for (const r of SCAN_ROOTS) go(join(ROOT, r))
  return out
}

ok(`除 ${SOURCE_FILE} 外无分类字面量副本`, offenders.length === 0,
  offenders.length ? `以下文件又抄了一份分类清单，请改为从真源派生：\n      ${offenders.join('\n      ')}` : '')
ok('真源自身确实列全了四个分类',
  CATEGORY_LITERALS.every(lit => readFileSync(join(ROOT, SOURCE_FILE), 'utf8').includes(lit)))

// ── 8. 品级 / 地区 / 来源三组枚举同样只能有单一真源 ──────────────────
// 与分类同源的毛病：`QUALITY_LEVELS` 曾有 3 份、`REGION_LABELS` 7 份、`SOURCE_LABELS` 6 份，
// 且**已经漂移出真实不一致** —— 2 份把 region 的展示标签写成「海外（需代理）」，
// 导致同一条通告在详情页显示「海外」、在编辑器的字段差异里显示「海外（需代理）」。
console.log('\n▶ 品级 / 地区 / 来源（第二组枚举）')

const FIELDS_SOURCE = 'utils/deal-fields.ts'
const {
  QUALITY_LEVELS, REGIONS, REGION_LABELS, REGION_OPTIONS,
  SOURCE_TAGS, SOURCE_LABELS, SOURCE_OPTIONS, regionLabel, sourceLabel,
} = await import('../utils/deal-fields.ts')

check('QUALITY_LEVELS 五档且顺序固定',
  JSON.stringify([...QUALITY_LEVELS]), JSON.stringify(['上上品', '上品', '中品', '下品', '下下品']))
check('REGIONS 两个取值', JSON.stringify([...REGIONS]), JSON.stringify(['cn', 'global']))
check('SOURCE_TAGS 三个取值', JSON.stringify([...SOURCE_TAGS]), JSON.stringify(['official', 'relay', 'community']))

// 展示标签 vs 填写提示：这两者**必须不同**，且展示口径要纯净（不含操作建议）
check('region 展示标签 global = 海外（不含「需代理」提示）',
  REGION_LABELS.global, '海外')
check('region 下拉提示 global 带「（需代理）」', REGION_OPTIONS.find(o => o.value === 'global')?.label, '海外（需代理）')
check('region 下拉每项都给出 displayLabel 供展示复用',
  REGION_OPTIONS.every(o => o.displayLabel === REGION_LABELS[o.value]), true)
check('regionLabel() 回落 cn', regionLabel('不存在的地区'), '国内直连')
check('sourceLabel() 回落 official', sourceLabel(undefined), '官方直营')

check('SOURCE_LABELS 三值齐全',
  SOURCE_TAGS.every(s => Boolean(SOURCE_LABELS[s])), true)
check('SOURCE_OPTIONS 由真源派生（同值同序）',
  JSON.stringify(SOURCE_OPTIONS.map(o => o.value)), JSON.stringify([...SOURCE_TAGS]))

// 防漂移：这两组枚举的字面量副本同样只许出现在真源里。
//
// 判据要精确，避免误伤两类**合法**写法：
//   1. `const REGION_LABELS = DEAL_REGION_LABELS` —— 这是**引用**真源，不是副本；
//   2. 样例/种子数据里的 `quality: '上上品'` —— 这是**取值**，不是枚举定义。
// 所以只认「字面对象 / 字面数组」形态的定义：
//   `REGION_LABELS = {`、`SOURCE_LABELS: Record<...> = {`、`QUALITY_LEVELS = ['`
const FIELD_OFFENDERS = []
for (const rel of walkAll()) {
  if (rel === FIELDS_SOURCE) continue
  let text
  try { text = readFileSync(join(ROOT, rel), 'utf8') } catch { continue }
  const bad = []
  if (/const QUALITY_LEVELS\s*=\s*\[/.test(text)) bad.push('品级数组定义')
  if (/(?:const|export const)\s+REGION_LABELS\s*(?::\s*Record<[^>]*>\s*)?=\s*\{/.test(text)) bad.push('REGION_LABELS 字面定义')
  if (/(?:const|export const)\s+SOURCE_LABELS\s*(?::\s*Record<[^>]*>\s*)?=\s*\{/.test(text)) bad.push('SOURCE_LABELS 字面定义')
  if (bad.length) FIELD_OFFENDERS.push(`${rel}（${bad.join('、')}）`)
}
ok(`品级/地区/来源枚举副本只允许在 ${FIELDS_SOURCE}`,
  FIELD_OFFENDERS.length === 0,
  FIELD_OFFENDERS.length ? `以下文件仍各自定义了一份，请改为从真源派生：\n      ${FIELD_OFFENDERS.join('\n      ')}` : '')

// ── 9. 已知消费方必须引用真源 ────────────────────────────────────────
console.log('\n▶ 已知消费方引用真源')
const CONSUMERS = [
  'components/tokens/TokenDealCard.vue',
  'components/tokens/TokenDealDetail.vue',
  'components/tokens/TokenDealEditor.vue',
  'components/tokens/TokenFilterBar.vue',
  'components/tokens/TokenDealsBoard.vue',
  'pages/tokens/index.vue',
  'pages/admin/token-deals.vue',
  'server/routes/sitemap.xml.ts',
  'server/utils/qq-notify.ts',
  'server/utils/deal-events.ts',
]
for (const rel of CONSUMERS) {
  let text = ''
  try { text = readFileSync(join(ROOT, rel), 'utf8') } catch {
    fail++; console.error(`✗ 消费方文件不存在：${rel}`); continue
  }
  ok(`${rel} 引用真源`, /deal-categories|DEAL_CATEGORY_LABELS|deal-fields/.test(text))
}

// ── 汇总 ────────────────────────────────────────────────────────────
console.log(`\n通过 ${pass} / ${pass + fail}`)
if (fail > 0) {
  console.error(`${fail} 项失败`)
  process.exit(1)
}
console.log('通告分类单一真源检查全部通过 ✓')
