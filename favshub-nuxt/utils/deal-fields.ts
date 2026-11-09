/**
 * 通告字段枚举 —— 品级 / 地区 / 来源 的**唯一真源**
 *
 * ## 为什么要这个文件
 *
 * 与 `utils/deal-categories.ts` 同一动机：这些枚举原先散在多处，
 * 且已经**漂移出真实的不一致**（不是理论风险）：
 *
 *   - `QUALITY_LEVELS` 有 3 份逐字相同的副本（服务端 + 编辑器 + 筛选栏）；
 *   - `REGION_LABELS` 有 7 份，其中 **2 份把 `global` 写成「海外（需代理）」**
 *     （`TokenDealEditor.vue` / `TokenEditReviewPanel.vue`），其余 5 份是「海外」——
 *     于是**同一条通告在详情页显示「海外」、在编辑器的字段差异里显示「海外（需代理）」**；
 *   - `SOURCE_LABELS` 有 6 份、`SOURCE_OPTIONS` 有 2 份。
 *
 * ## 一个刻意的区分：「展示标签」 vs 「填写提示」
 *
 * 地区这一项有两种合理措辞，**用途不同，不能合并**：
 *
 *   - **展示标签**（`REGION_LABELS`）：「海外」。用于卡片、详情页、后台列表、
 *     字段差异表等**呈现已有数据**的地方 —— 读者看的是「这条通告在哪个区」，
 *     不该被塞一句操作建议。
 *   - **填写提示**（`REGION_OPTIONS` 的 label）：「海外（需代理）」。用于**让人选**的
 *     下拉框 —— 这里提示一句「可能要代理」对填的人是有效信息。
 *
 * 所以两者都留在真源里，但语义分开。历史 bug 正是把「填写提示」误当成
 * 「展示标签」抄进了字段差异表。
 *
 * ## 顺带记住：`REAL_NAME_LABELS` **故意不做单一真源**
 *
 * 它有两份且**必须不同**：服务端那份是徽标文案（「需身份证」「需人脸」），
 * 编辑器那份是表单里的短值（「身份证」「人脸」「其他」，外加一个「未标注」）。
 * 两者服务于不同界面，强行合并会把其中一边的文案改坏。这种「看似重复、
 * 实则各有语义」的情况要**先分清再动手**，不要为了整齐而统一。
 */

// ── 品级 ────────────────────────────────────────────────────────────

/** 品级取值，由高到低（顺序即展示顺序） */
export const QUALITY_LEVELS = ['上上品', '上品', '中品', '下品', '下下品'] as const

export type QualityLevel = (typeof QUALITY_LEVELS)[number]

/** 品级下拉选项（编辑器 / 筛选栏共用；值即标签） */
export const QUALITY_OPTIONS: readonly { value: QualityLevel, label: string }[]
  = QUALITY_LEVELS.map(q => ({ value: q, label: q }))

// ── 地区 ────────────────────────────────────────────────────────────

export const REGIONS = ['cn', 'global'] as const

export type RegionValue = (typeof REGIONS)[number]

/** **展示**用标签 —— 呈现已有数据的地方一律用这个 */
export const REGION_LABELS: Record<string, string> = {
  cn: '国内直连',
  global: '海外',
}

/**
 * **填写**用选项 —— 给下拉框，可以带提示语。
 *
 * 注意与 `REGION_LABELS` 的区别：这里 `global` 带「（需代理）」提示，
 * 因为它出现在「你要选哪个」的语境里。**不要把它用在展示已有数据的地方** ——
 * 那会让同一条通告在详情页和编辑器里显示不同的地区名（曾经就是这么错的）。
 */
export const REGION_OPTIONS: readonly { value: RegionValue, label: string, displayLabel: string }[] = [
  { value: 'cn', label: '国内直连', displayLabel: '国内直连' },
  { value: 'global', label: '海外（需代理）', displayLabel: '海外' },
]

/** 取展示标签，未知名回落 `cn`（与全站默认值一致） */
export function regionLabel(value: unknown): string {
  return REGION_LABELS[String(value ?? '')] || REGION_LABELS.cn!
}

// ── 来源 ────────────────────────────────────────────────────────────

export const SOURCE_TAGS = ['official', 'relay', 'community'] as const

export type SourceTag = (typeof SOURCE_TAGS)[number]

export const SOURCE_LABELS: Record<string, string> = {
  official: '官方直营',
  relay: '中转站',
  community: '社区转发',
}

/** 来源下拉选项（编辑器 / 筛选栏共用） */
export const SOURCE_OPTIONS: readonly { value: SourceTag, label: string }[]
  = SOURCE_TAGS.map(s => ({ value: s, label: SOURCE_LABELS[s]! }))

/** 取来源标签，未知名回落 `official` */
export function sourceLabel(value: unknown): string {
  return SOURCE_LABELS[String(value ?? '')] || SOURCE_LABELS.official!
}

// ── 发布者类型（筛选栏的 origin 维度）────────────────────────────────

/**
 * 后台筛选栏「发布者类型」这一维的取值 —— **与服务端同一个真源**。
 *
 * ## 为什么搬到这里（2026-11-09）
 *
 * 原先这个白名单是写在路由文件里的一个局部常量
 * （`server/api/admin/token-deals/index.get.ts` 的 `const ORIGIN_FILTERS`），
 * 而后台筛选栏的**两处**（队列侧与已失效侧）把 `guest` / `user` **手抄**在模板里。
 * 于是有一条不会报错、只会静默失效的路径：
 *
 *   · 服务端将来多一个档位（例如管理员代发的 `system`）→ 下拉里根本没有这一项，
 *     **筛不出来**，而没有任何测试或报错会提示；
 *   · 或者模板被改成 `visitor`、服务端仍认 `guest` → `pickEnum` 认不出 →
 *     **降级成「不筛」**，界面上表现为「选了但列表没变」，与「后端没实现」无法区分。
 *
 * 现在两处都 `v-for` 这张表，且服务端也从这里 import —— 单点改动，两侧自动跟上。
 * `scripts/admin-filter-wiring.mjs` 会守住这件事（含「筛选栏里不许再出现手写的
 * 非空 option」这条）。
 */
export const ORIGIN_FILTERS = ['guest', 'user'] as const

export type OriginFilter = (typeof ORIGIN_FILTERS)[number]

/** 发布者类型下拉选项（后台筛选栏两处共用） */
export const ORIGIN_OPTIONS: readonly { value: OriginFilter, label: string }[] = [
  { value: 'guest', label: '游客' },
  { value: 'user', label: '注册用户' },
]
