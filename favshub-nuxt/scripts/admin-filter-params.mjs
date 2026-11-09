/**
 * 后台通告列表「筛选参数构造器」单测 —— `utils/admin-deal-filters.ts`
 *
 * ## 为什么要有这个套件
 *
 * 独立审查（2026-11-09）指出：`pages/admin/token-deals.vue` 里拼 7 个筛选参数那一层
 * **没有任何测试**。而这一层恰好是最容易悄悄坏掉的地方：
 *
 *   - 参数名写错（`source` vs `source_tag`）→ 后端 `pickEnum` 认不出，**静默当作不筛**，
 *     界面表现与「后端没实现这个筛选」一模一样，极难定位；
 *   - 空值也发出去 → URL 脏，且后端多一层判断；
 *   - 该 trim 没 trim → 全空格变成 `search=%20%20`，命中 0 条却看不出原因。
 *
 * 2026-11-09 起这条筛选条同时服务「全部 / 待审核 / 已发布…」与「已失效」两个视图，
 * 参数构造收进了 `utils/admin-deal-filters.ts`（单一真源），于是可以脱离浏览器单测。
 *
 * ## 本套件守的两类不变式
 *
 * 1. **行为**：空值不发、`search` 要 trim、`invalid_reason` 只随「已失效」视图发、
 *    参数顺序稳定、`hasAny`/`clear` 与字段清单同源。
 * 2. **与服务端不漂移**：把字段表里每个 `param` 拿去**真实服务端源码**里找，
 *    找不到就报红。这条是本套件最重要的断言 —— 它是唯一能抓住
 *    「前端参数名改了、后端白名单没跟上（或反之）」的东西。
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

// ── 加载被测模块（.ts 纯类型 + 普通 JS，Node ≥22.6 可直接剥离类型加载）──
const mod = await import(join(ROOT, 'utils', 'admin-deal-filters.ts'))
const {
  ADMIN_DEAL_FILTER_FIELDS,
  appendAdminDealFilters,
  hasAnyAdminDealFilter,
  clearAdminDealFilters,
} = mod

console.log('▶ ① 空值一律不 append')
{
  check('全空状态 → 一个参数都不发', [...appendAdminDealFilters(new URLSearchParams(), {})].length === 0)
  check('字段值为空串 → 不发',
    [...appendAdminDealFilters(new URLSearchParams(), {
      search: '', category: '', quality: '', region: '', sourceTag: '', invalidReason: '', origin: '',
    })].length === 0)
  check('字段值为 undefined → 不发',
    [...appendAdminDealFilters(new URLSearchParams(), { category: undefined, origin: undefined })].length === 0)
}

console.log('\n▶ ② search 必须 trim（否则全空格命中 0 条却看不出原因）')
{
  const p = appendAdminDealFilters(new URLSearchParams(), { search: '  阿里云  ' })
  check('两侧空白被去掉', p.get('search') === '阿里云', `实际 ${JSON.stringify(p.get('search'))}`)

  const onlySpace = appendAdminDealFilters(new URLSearchParams(), { search: '   ' })
  check('纯空白 → 视为不筛（不发 search）', onlySpace.get('search') === null, `实际 ${JSON.stringify(onlySpace.get('search'))}`)
  check('纯空白 → hasAny 为 false', hasAnyAdminDealFilter({ search: '   ' }) === false)
}

console.log('\n▶ ③ 参数名与服务端读取处逐字对齐（**最重要**：前后端漂移守卫）')
{
  // 服务端参数名的真源就是这个文件。
  //
  // ⚠️ 第一版判据是「源码里出现 `'param'`」，结果**靠巧合通过**：命中的是文件顶部
  // **文档注释**里的反引号（`` `category` ``），而不是真实读取处；而 `search` /
  // `invalid_reason` / `origin` 在注释里没被反引号单独包住，就误报红了。
  // 这种「判据命中的是注释」的守卫等于没有守卫 —— 与本次审查在
  // `ssrf-pin-check` 上抓到的「复刻件 vs 真实源码」是同一类坑。
  //
  // 现在改成：**先剥掉注释**，再要求服务端**真实读取表达式** `query.<param>` 存在。
  // 前端改名 → 报红；后端把 `query.source_tag` 改成别的 → 也报红。
  const raw = readFileSync(join(ROOT, 'server', 'api', 'admin', 'token-deals', 'index.get.ts'), 'utf8')
  const serverSrc = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 块注释
    .replace(/^\s*\/\/.*$/gm, '')          // 行注释
  check('剥离注释后仍有内容（避免正则误删整份文件而假绿）', serverSrc.length > raw.length * 0.3,
    `${serverSrc.length} / ${raw.length}`)
  for (const f of ADMIN_DEAL_FILTER_FIELDS) {
    // ⚠️ 必须按**标识符边界**匹配，不能用 `includes`：
    // 变异测试（把 `source_tag` 改成 `source`）时 `serverSrc.includes('query.source')`
    // 会被服务端真实存在的 `query.source_tag` **前缀命中**而假绿 —— 那条变异最后是靠
    // 另一条断言才抓到的。加 `(?![A-Za-z0-9_])` 后 `query.source` 不再被 `query.source_tag` 满足。
    const re = new RegExp(`query\\.${f.param}(?![A-Za-z0-9_])`)
    check(`服务端真实读取处存在 query.${f.param}`, re.test(serverSrc),
      `未找到独立的 query.${f.param}`)
  }
  check('字段表里没有重复的 param', new Set(ADMIN_DEAL_FILTER_FIELDS.map(f => f.param)).size === ADMIN_DEAL_FILTER_FIELDS.length)
  check('字段表里没有重复的 key', new Set(ADMIN_DEAL_FILTER_FIELDS.map(f => f.key)).size === ADMIN_DEAL_FILTER_FIELDS.length)
}

console.log('\n▶ ④ invalid_reason 只随「已失效」视图发（队列里没有这个概念）')
{
  const state = { category: 'cloud', invalidReason: 'votes' }

  const queue = appendAdminDealFilters(new URLSearchParams(), state)
  check('队列视图（默认）不发 invalid_reason', queue.get('invalid_reason') === null, `实际 ${JSON.stringify(queue.get('invalid_reason'))}`)
  check('队列视图其余字段照发', queue.get('category') === 'cloud')
  check('队列视图 → hasAny 看得到 category', hasAnyAdminDealFilter(state) === true)

  const invalid = appendAdminDealFilters(new URLSearchParams(), state, { includeInvalidReason: true })
  check('已失效视图发 invalid_reason', invalid.get('invalid_reason') === 'votes', `实际 ${JSON.stringify(invalid.get('invalid_reason'))}`)

  const onlyReason = appendAdminDealFilters(new URLSearchParams(), { invalidReason: 'expired' })
  check('只给了失效原因、队列视图 → 什么都不发（不能变成空筛选的假象）',
    [...onlyReason].length === 0, `实际 ${JSON.stringify([...onlyReason])}`)
  check('只给了失效原因、队列视图 → hasAny 为 false（重置按钮因此置灰）',
    hasAnyAdminDealFilter({ invalidReason: 'expired' }) === false)
}

console.log('\n▶ ⑤ 参数顺序稳定（便于人工比对与 URL 可读）')
{
  const p = appendAdminDealFilters(new URLSearchParams(), {
    origin: 'guest', sourceTag: 'official', region: 'cn', quality: '上品', category: 'token',
    search: 'kw', invalidReason: 'manual',
  }, { includeInvalidReason: true })
  const got = [...p.keys()].join(',')
  const want = ADMIN_DEAL_FILTER_FIELDS.filter(f => p.has(f.param)).map(f => f.param).join(',')
  check('顺序与字段表一致', got === want, `实际 ${got} / 期望 ${want}`)
  check('七个参数一个不少',
    p.has('search') && p.has('category') && p.has('quality') && p.has('region')
    && p.has('source_tag') && p.has('invalid_reason') && p.has('origin'), got)
}

console.log('\n▶ ⑥ 不覆盖调用方已有的参数（就地追加）')
{
  const p = new URLSearchParams({ view: 'invalid', lifecycle: 'all', page: '1', limit: '20' })
  const ret = appendAdminDealFilters(p, { category: 'domain' })
  check('返回的是同一个对象（便于串写）', ret === p)
  check('既有参数保留', p.get('view') === 'invalid' && p.get('lifecycle') === 'all'
    && p.get('page') === '1' && p.get('limit') === '20')
  check('新参数被追加', p.get('category') === 'domain', String(p))
  check('既有参数不重复（重名不 append 两次）',
    p.getAll('page').length === 1, JSON.stringify(p.getAll('page')))
}

console.log('\n▶ ⑦ clear 与字段清单同源（新增维度不必改这里）')
{
  const state = {
    search: 'kw', category: 'cloud', quality: '上品', region: 'cn',
    sourceTag: 'relay', invalidReason: 'votes', origin: 'guest',
  }
  clearAdminDealFilters(state)
  const leftovers = ADMIN_DEAL_FILTER_FIELDS.filter(f => state[f.key] !== '')
  check('所有字段被清空', leftovers.length === 0, `残留 ${leftovers.map(f => f.key).join(',')}`)
  check('清空后 hasAny 为 false（含失效原因视图）',
    hasAnyAdminDealFilter(state, { includeInvalidReason: true }) === false)
  check('字段清单覆盖 7 个筛选维度', ADMIN_DEAL_FILTER_FIELDS.length === 7, String(ADMIN_DEAL_FILTER_FIELDS.length))
}

console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
if (fails.length) {
  console.log('失败项：')
  for (const f of fails) console.log('  - ' + f)
}
process.exit(fails.length ? 1 : 0)
