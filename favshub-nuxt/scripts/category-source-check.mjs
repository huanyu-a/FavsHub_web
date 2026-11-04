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

ok(`除 ${SOURCE_FILE} 外无分类字面量副本`, offenders.length === 0,
  offenders.length ? `以下文件又抄了一份分类清单，请改为从真源派生：\n      ${offenders.join('\n      ')}` : '')
ok('真源自身确实列全了四个分类',
  CATEGORY_LITERALS.every(lit => readFileSync(join(ROOT, SOURCE_FILE), 'utf8').includes(lit)))

// ── 7. 已知消费方必须引用真源 ────────────────────────────────────────
// 光靠「字面量不到 3 个」可能漏掉「只认 2 个分类」的手写分支（qq-notify 就是这样漏掉
// domain 的）。所以对已知消费方额外断言它们确实引用了真源模块。
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
  ok(`${rel} 引用真源`, /deal-categories|DEAL_CATEGORY_LABELS/.test(text))
}

// ── 汇总 ────────────────────────────────────────────────────────────
console.log(`\n通过 ${pass} / ${pass + fail}`)
if (fail > 0) {
  console.error(`${fail} 项失败`)
  process.exit(1)
}
console.log('通告分类单一真源检查全部通过 ✓')
