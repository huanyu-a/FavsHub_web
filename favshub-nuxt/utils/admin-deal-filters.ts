/**
 * 后台「Token 通告」列表的**筛选参数构造器 —— 单一真源**
 *
 * ## 为什么要有这个文件
 *
 * 筛选条原先只长在「已失效」这一个 tab 里，参数在一个 `.vue` 内的局部函数里拼
 * （`invalidFilterParams()`）。2026-11-09 把筛选条也接到「全部 / 待审核 / 已发布…」
 * 这些队列 tab 上之后，同一套参数要在**两处**拼 —— 各抄一份就必然漂移：
 * 加一个筛选维度时改了一处、忘了另一处，表现是「下拉选了但列表没变」，
 * 而这种错在 UI 上看起来跟后端没实现一模一样，极难定位。
 *
 * 另一个直接原因：那一层**从来没有测试**（独立审查 2026-11-09 指出）。
 * 参数拼错（名字写错、该 trim 没 trim、空值也发出去）不会被任何套件发现。
 * 抽成纯函数后就能被 Node 直接 import 单测，不必起浏览器。
 *
 * ## 约定
 *
 * - **空值一律不 append**：URL 干净，后端也少一层判断。
 * - `search` 要 `trim()`：否则全空格会变成 `search=%20%20`，命中 0 条却看不出原因。
 * - `invalid_reason` **只对「已失效」视图有意义** —— 服务端 `view === 'invalid'` 时才应用它，
 *   队列视图会忽略。所以队列侧**不发**这个参数，免得出现「筛了失效原因但列表没变」的困惑。
 *   注意：服务端忽略它是**对的**（队列里本就没有「失效原因」这个概念），
 *   前端不发只是为了避免无意义的参数与误解，两边语义一致。
 */

/** 一次筛选的完整状态（`''` 与 `undefined` 都表示「不筛」） */
export interface AdminDealFilterState {
  search?: string
  category?: string
  quality?: string
  region?: string
  sourceTag?: string
  invalidReason?: string
  origin?: string
}

export interface AdminDealFilterField {
  /** 状态里的字段名 */
  key: keyof AdminDealFilterState
  /** 发给后端的 query 参数名（与 `server/api/admin/token-deals/index.get.ts` 对齐） */
  param: string
  /** 仅「已失效」视图才有意义的字段 */
  invalidOnly?: boolean
  /** 发出去之前先 trim */
  trim?: boolean
}

/**
 * 筛选维度的**唯一清单**：参数构造与「是否可以重置」都从它派生。
 * 新增一个筛选维度只需要在这里加一行，两处自动跟上。
 */
export const ADMIN_DEAL_FILTER_FIELDS: readonly AdminDealFilterField[] = [
  { key: 'search', param: 'search', trim: true },
  { key: 'category', param: 'category' },
  { key: 'quality', param: 'quality' },
  { key: 'region', param: 'region' },
  { key: 'sourceTag', param: 'source_tag' },
  { key: 'invalidReason', param: 'invalid_reason', invalidOnly: true },
  { key: 'origin', param: 'origin' },
] as const

export interface AdminDealFilterOpts {
  /** 「已失效」视图传 true；队列视图（含「全部」tab）用默认的 false */
  includeInvalidReason?: boolean
}

/** 取某个字段**归一化后**的值（trim + 空串视作无值） */
function normalized(state: AdminDealFilterState, field: AdminDealFilterField): string {
  const raw = state[field.key]
  const value = field.trim ? String(raw ?? '').trim() : String(raw ?? '')
  return value
}

/**
 * 把筛选状态追加到 `params` 上（就地修改并返回同一个对象，便于串写）。
 * 顺序与 `ADMIN_DEAL_FILTER_FIELDS` 一致，便于测试与人工比对。
 */
export function appendAdminDealFilters(
  params: URLSearchParams,
  state: AdminDealFilterState,
  opts: AdminDealFilterOpts = {},
): URLSearchParams {
  for (const field of ADMIN_DEAL_FILTER_FIELDS) {
    if (field.invalidOnly && !opts.includeInvalidReason) continue
    const value = normalized(state, field)
    if (value) params.append(field.param, value)
  }
  return params
}

/** 是否有任一筛选生效（决定「重置」按钮是否可点） */
export function hasAnyAdminDealFilter(
  state: AdminDealFilterState,
  opts: AdminDealFilterOpts = {},
): boolean {
  for (const field of ADMIN_DEAL_FILTER_FIELDS) {
    if (field.invalidOnly && !opts.includeInvalidReason) continue
    if (normalized(state, field)) return true
  }
  return false
}

/** 清空全部筛选字段（就地修改并返回，页面里配合 `reactive` 使用） */
export function clearAdminDealFilters(state: AdminDealFilterState): AdminDealFilterState {
  for (const field of ADMIN_DEAL_FILTER_FIELDS) state[field.key] = ''
  return state
}
