/**
 * 通告分类 —— **全站唯一真源**
 *
 * ## 为什么要有这个文件
 *
 * 「通告分类」这个枚举原先散在 **8 处**：服务端校验、卡片徽标、详情页徽标、
 * 编辑器下拉、筛选栏下拉、后台列表标签、首页分类导航卡、sitemap 路由。
 * 每加一个分类都要手改 8 个地方，而注释只能祈祷下一个人看见。
 *
 * 这不是理论风险，是**已经发生过三次的实伤**（原注释都还留在各文件里）：
 *
 *   1. `client`（客户端额度）漏在首页导航卡与 sitemap —— 4 条客户端额度通告
 *      在首页没有任何入口，也没有可被搜索引擎收录的落地页，用户只能在「全部」里翻；
 *   2. `domain`（免费域名）在**后台**被显示成「API 额度」—— 审核的人分不清
 *      这条到底是域名还是模型额度；
 *   3. `TokenDealCard` 的徽标表只认 cloud / client，新增 domain 后卡片不显示徽标。
 *
 * 所以这里把「一个分类有哪些属性」收成一张表，其余各处一律**派生**，
 * 而不是各抄一份。新增分类只需要在 `DEAL_CATEGORY_META` 里加一行。
 *
 * ## 顺序即展示顺序
 *
 * `DEAL_CATEGORY_META` 的数组顺序 = 筛选栏顺序 = 首页导航卡顺序 = sitemap 顺序。
 * 迁移里 `category` 列的默认值恒为 `'token'`，新增分类**不需要**改默认值。
 *
 * ## 为什么放 `utils/`（根目录）而不是 `server/utils/`
 *
 * 服务端与前端（含 SSR 与客户端 bundle）都要读这张表，放根目录 `utils/` 才能
 * 被两侧以同一条相对路径引用；本文件**只有纯常量**，不 import 任何 DB / Node 内置。
 *
 * ⚠️ 各消费方请用**显式相对路径**引入（如 `~/utils/deal-categories`），
 *    不要依赖自动导入 —— 自动导入在 `server/` 与组件里的解析范围不同，
 *    出问题时很难查。
 */

/** 分类取值 —— 顺序即展示顺序（`domain` 在 `client` 之前） */
export const DEAL_CATEGORIES = ['token', 'cloud', 'domain', 'client'] as const

export type DealCategory = (typeof DEAL_CATEGORIES)[number]

export interface DealCategoryMeta {
  value: DealCategory
  /** 全站统一标签（筛选栏 / 编辑器 / 卡片 / 详情 / AI 字段字典用这个） */
  label: string
  /** 紧凑标签 —— 只给后台列表那种窄徽标用 */
  shortLabel: string
  /** 详情页徽标的色调（取自站点既有变量，不引入新色板） */
  tone: string
  /** 分类落地页路径 */
  route: string
  /** 首页导航卡标题（比 label 更口语） */
  cardName: string
  /** 首页导航卡图标 */
  icon: string
  /** 首页导航卡描述 */
  desc: string
  /**
   * 卡片上是否显示分类徽标。
   *
   * `token` 是默认分类、占绝大多数，每条都挂个「API 额度」徽标纯属噪音，
   * 所以卡片对它不显示（`TokenDealCard` 原先用「表里没有 token 键」隐式表达
   * 这件事 —— 太隐晦，读代码的人分不清是**故意**还是**漏了**，这里写明白）。
   */
  showBadge: boolean
}

/** 分类真源表 —— 新增分类**只需改这里一处** */
export const DEAL_CATEGORY_META: readonly DealCategoryMeta[] = [
  {
    value: 'token',
    label: 'API 额度',
    shortLabel: 'API 额度',
    tone: 'blue',
    route: '/tokens/api',
    cardName: '免费 API / 模型',
    icon: 'ri-robot-2-line',
    desc: '各家大模型与推理服务的免费额度、试用金、每日签到送 Token。',
    showBadge: false,
  },
  {
    value: 'cloud',
    label: '免费云服务器',
    shortLabel: '云服务器',
    tone: 'purple',
    route: '/tokens/server',
    cardName: '免费服务器 / VPS',
    icon: 'ri-server-line',
    desc: '免费云主机、PaaS 与 Serverless 免费档，能真正跑起一个小站或 Bot。',
    showBadge: true,
  },
  {
    value: 'domain',
    label: '免费域名',
    shortLabel: '免费域名',
    tone: 'teal',
    route: '/tokens/domain',
    cardName: '免费域名',
    icon: 'ri-global-line',
    desc: '免费二级域名、公益顶级域与 DDNS，给自建服务一个稳定入口。',
    showBadge: true,
  },
  {
    value: 'client',
    label: '客户端额度',
    shortLabel: '客户端额度',
    tone: 'primary',
    route: '/tokens/client',
    cardName: '客户端额度',
    icon: 'ri-apps-2-line',
    desc: '桌面 / 移动端 AI 客户端自带的免费额度：注册积分、每日签到、拉新奖励。',
    showBadge: true,
  },
]

/** 值 → 元数据。查不到时回落到 `token`（与全站「默认分类」口径一致） */
export const DEAL_CATEGORY_BY_VALUE: Record<string, DealCategoryMeta>
  = Object.fromEntries(DEAL_CATEGORY_META.map(m => [m.value, m]))

/** 取元数据，未知名回落 `token` */
export function dealCategoryMeta(value: unknown): DealCategoryMeta {
  return DEAL_CATEGORY_BY_VALUE[String(value ?? '')] || DEAL_CATEGORY_BY_VALUE.token!
}

/** 全站统一标签表（服务端 `DEAL_CATEGORY_LABELS` 同源） */
export const DEAL_CATEGORY_LABELS: Record<string, string>
  = Object.fromEntries(DEAL_CATEGORY_META.map(m => [m.value, m.label]))

/** 紧凑标签表（后台列表徽标） */
export const DEAL_CATEGORY_SHORT_LABELS: Record<string, string>
  = Object.fromEntries(DEAL_CATEGORY_META.map(m => [m.value, m.shortLabel]))

/** 下拉选项（筛选栏 / 编辑器共用；顺序即展示顺序） */
export const DEAL_CATEGORY_OPTIONS: readonly { value: DealCategory, label: string }[]
  = DEAL_CATEGORY_META.map(m => ({ value: m.value, label: m.label }))

/**
 * 首页分类导航卡（顺序即展示顺序）。
 *
 * 同时给出 `value` 与别名 `category`：模板与统计逻辑历史上按 `card.category`
 * 取值，保留别名可让消费方**零改动**接入；新代码请用 `value`。
 */
export const DEAL_CATEGORY_CARDS: readonly (DealCategoryMeta & { to: string, name: string, category: DealCategory })[]
  = DEAL_CATEGORY_META.map(m => ({ ...m, to: m.route, name: m.cardName, category: m.value }))

/** 分类落地页路径表 —— sitemap 用它，避免再手抄一遍路由 */
export const DEAL_CATEGORY_ROUTES: readonly string[]
  = DEAL_CATEGORY_META.map(m => m.route)
