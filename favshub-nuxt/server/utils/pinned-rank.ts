/**
 * 置顶位（2026-11-16）——「每个页面取热度最高的 3 个置顶」。
 *
 * ## 改动前是什么问题
 *
 * `token_deals.pinned` 原本是个**开关**：管理员点一下就永远置顶。线上 7 条全是置顶，
 * 前台 `ORDER BY d.pinned DESC` 把它们整堆顶在列表最前。置顶位是稀缺资源 ——
 * 全都置顶等于没有置顶，真正的热门条目被挤到看不见的位置。
 *
 * ## 现在怎么算
 *
 * - **候选池**：仍然只认管理员置顶过的条目（`pinned = 1`）。置顶能力保留，
 *   只是它现在表示「入选候选池」，不再等于「自动顶到最前」。
 * - **每个页面 3 个**：排名在**当前查询的范围内**各算一次。
 *   分类页（`/tokens/api` 等）会带 `category` 筛选，所以范围就是那个分类 → 各取 3 个；
 *   `/tokens` 首页不带分类筛选，范围是全部 → 全站取 3 个。
 *   这正是需求的两句话：「每个页面的置顶都是热度最高的 3 个」+「首页同样展示为 3 个」。
 * - **候选池里排名 > 3 的条目**落回普通排序，与未置顶条目一起参与次级排序。
 *
 * ⚠️ 这里**刻意不按 category 分区**（不用 `PARTITION BY category`）。
 * 分区会让首页变成「每个分类各 3 个」，线上 4 个分类共 7 个候选 → 首页出现 6 个置顶，
 * 与「首页展示 3 个」直接冲突。排名范围 = 用户的筛选范围，这个语义才与页面自洽。
 *
 * ## 热度口径
 *
 * 投票净分 `vote_up - vote_down`，与站点现有 `sort=hot` **同一个表达式**
 * （见 `api/token-deals/index.get.ts`）。两处口径若不同，同一条目会在
 * 「最热」排序里第 3、在置顶位里第 8，用户看到的是自相矛盾的排名。
 */

/** 每个页面最多几个置顶 */
export const PINNED_SLOTS = 3

/**
 * 热度表达式：投票净分。`COALESCE` 兜住 NULL（老行 / 脏数据）。
 *
 * @param alias 表别名（列表查询用 'd'）
 */
export function hotExpr(alias = 'd'): string {
  return `(COALESCE(${alias}.vote_up, 0) - COALESCE(${alias}.vote_down, 0))`
}

/**
 * 热度排序键：净分 → 赞数 → 创建时间倒序 → id。
 *
 * `id` 兜底是必需的：没有它，两条同分同时间的条目次序由 SQLite 自行决定，
 * 每次查询可能不同 —— 分页时就会漏条目或重复条目。
 *
 * @param alias 表别名
 */
export function hotOrder(alias = 'd'): string {
  return `${hotExpr(alias)} DESC, COALESCE(${alias}.vote_up, 0) DESC, ${alias}.created_at DESC, ${alias}.id ASC`
}

/**
 * 置顶排名 CTE 的**内部查询**（拼在 `WITH pr AS (...)` 里）。
 *
 * 只含 `pinned = 1` 的候选，在**当前筛选范围内**按热度算 `ROW_NUMBER`。
 * 用窗口函数而不是「先查出来再在内存里排」是因为列表要分页：
 * 内存里排名会让第 2 页重新从 1 开始数，置顶位在第 2 页又冒出来一遍。
 *
 * @param whereClause 公开可见 + 全部筛选条件（不含 LIMIT/OFFSET）
 * @param alias       表别名（Web 通道用 'd'，AI 通道用 'td'）
 */
export function pinnedRankQuery(whereClause: string, alias = 'd'): string {
  return `SELECT ${alias}.id AS id,
      ROW_NUMBER() OVER (ORDER BY ${hotOrder(alias)}) AS pinned_rank
    FROM token_deals ${alias}
    WHERE ${whereClause} AND ${alias}.pinned = 1`
}

/**
 * 置顶位的 ORDER BY 前缀。
 *
 * 只做**分组**：rank ≤ 3 的候选排最前（0），其余排后面（1）。
 * 组**内**的次序交给调用方接的次级排序 —— 这一点是刻意的：
 *
 * 需求「热度最高的 3 个」说的是**哪 3 条占住置顶位**（入选规则），
 * 不是「这 3 条必须按热度先后显示」。若在这里强制按 rank 排，
 * 用户点「评分」或「最新」时这 3 条不跟着动，排序按钮等于失效了一半。
 * 因此：**入选按热度，组内按用户选的排序**。
 *
 * @param cteAlias 排名 CTE 的别名（默认 'pr'）
 */
export function pinnedOrderPrefix(cteAlias = 'pr'): string {
  return `CASE WHEN ${inSlotCond(cteAlias)} THEN 0 ELSE 1 END ASC`
}

function inSlotCond(cteAlias: string): string {
  return `${cteAlias}.pinned_rank IS NOT NULL AND ${cteAlias}.pinned_rank <= ${PINNED_SLOTS}`
}

/**
 * 该行是否**实际**占据了置顶位（供接口下发改写后的 `pinned`）。
 *
 * 为什么要把 `pinned` 下发值改掉：卡片在 `pinned=1` 时画图钉、加「已置顶」底色。
 * 若第 4~7 名仍下发 1，它们会散落在列表中间却带着图钉 —— 看起来像置顶失效。
 * 实际生效的置顶位只有这 3 个，下发的就应当只有这 3 个。
 *
 * @param rank 该行的 `pinned_rank`（非候选为 null/undefined）
 */
export function occupiesPinnedSlot(rank: unknown): boolean {
  const n = Number(rank)
  return Number.isFinite(n) && n >= 1 && n <= PINNED_SLOTS
}
