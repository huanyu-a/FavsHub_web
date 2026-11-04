/**
 * GET /api/token-keys/:id/copy — 复制专用明文端点（2026-10-08 二次调整）。
 *
 * 背景：key 明文绝不允许进入页面渲染层（SSR HTML / Nuxt payload 都不行 ——
 * props 会被序列化进 __NUXT_DATA__）。列表接口不再下发 key_plain；前端点击
 * 「复制 Key」时才来这里取一次明文写入剪贴板。
 *
 * ## 可见性（**与列表有意不一致**，见下）
 *
 *   - `deal_status = 'published'`（挡 pending / hidden / invalid）
 *   - `verdict != 'dead'`
 *   - 回帖指引行（C 类 `reply_visible_guide`）**一律不可复制**
 *   - 无任何 key 数据的行不可复制
 *
 * 2026-11-05 更正：本文件原注释写着「可见性与列表完全同口径……回帖指引限 24h」，
 * **那是错的**，且代码里那段 24h 判断是**不可达死代码** ——
 * 列表的规则是 `(source != 'reply_visible_guide' OR first_seen_at > 24h)`（指引行**在**窗口内可见），
 * 而本端点在它之前就无条件否决了全部指引行，所以后面那个 `&& !(first_seen_at > cutoff)`
 * 永远轮不到执行。
 *
 * 为什么本端点**应当**比列表严：这两者的用途不同。
 *   - 列表里的指引行是**行动号召**（「去原帖回复领取」），卡片渲染的是跳原帖的 CTA，
 *     不需要任何 key 数据（前端以 `isGuide` 隐藏复制按钮）——所以它该出现在列表；
 *   - 而本端点只做一件事：**交出明文 key**。指引行没有任何 key（2026-11-05 核对生产：
 *     29 条指引行，有明文 0 条、有掩码 0 条），交不出东西，故必须 404。
 * 把 24h 窗口搬到这里没有意义，已删除；窗口逻辑只在列表侧（`index.get.ts`）保留一份。
 *
 * ## 不区分「不存在」与「不可见」
 *
 * 所有拒绝分支（不存在 / 未发布 / 已失效 / 指引行 / 无 key 数据）**返回同一条文案**，
 * 避免通过文案差异探测某个 id 是否存在。
 * 2026-11-05 更正：原先「无 key 数据」一条单独用了别的文案（`该行没有可复制的 Key`），
 * 与「不区分」的声明自相矛盾 —— 知道 id 的人据此能判断该行存在。
 * 该文案从不出现在用户路径上（前端对无 key 的行不显示复制按钮），
 * 所以统一文案**不损失任何可用性**，纯粹收紧。
 *
 * 鉴权：无（与公开列表同语义）；限频继承全局 rate-limit 中间件。
 */
import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { getRawDb } from '../../../database'

/** 所有拒绝分支共用的文案 —— 见文件头「不区分『不存在』与『不可见』」 */
const NOT_FOUND_MESSAGE = 'Key 不存在或已下架'

export default defineEventHandler((event) => {
  // 明文端点绝不入任何缓存（浏览器 / CDN / Nitro route cache 一律绕过）——
  // 虽有全局 API 兜底，这里显式声明作为安全契约的一部分。
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, private')
  setHeader(event, 'Vary', 'Cookie')

  const id = getRouterParam(event, 'id') || ''
  if (!/^[\w-]{1,80}$/.test(id)) {
    throw createError({ statusCode: 400, data: { error: 'id 格式非法' } })
  }

  const row = getRawDb().prepare(
    'SELECT key_plain, key_masked, base_url, deal_status, verdict, source'
    + ' FROM token_keys WHERE id = ?',
  ).get(id) as {
    key_plain: string | null
    key_masked: string | null
    base_url: string | null
    deal_status: string
    verdict: string
    source: string
  } | undefined

  // 注意顺序与语义：这里**不**做 24h 判断 —— 指引行在列表里可见（它是 CTA），
  // 但它没有任何 key，故在本端点一律 404。详见文件头。
  if (!row
    || row.deal_status !== 'published'
    || row.verdict === 'dead'
    || row.source === 'reply_visible_guide') {
    throw createError({ statusCode: 404, data: { error: NOT_FOUND_MESSAGE } })
  }

  const plain = String(row.key_plain || '').trim()
  const masked = String(row.key_masked || '').trim()
  if (!plain && !masked) {
    // 可见但没有可交出的 key（历史行）。文案与其他拒绝分支**刻意一致**。
    throw createError({ statusCode: 404, data: { error: NOT_FOUND_MESSAGE } })
  }

  // 复制热度计数（站点本地数据，爬虫上报不涉及）：best-effort，失败不影响取 key。
  // GET 里做写计数是浏览计数同款实践，单语句原子；limit 频率由全局中间件兜底。
  try {
    getRawDb().prepare('UPDATE token_keys SET copy_count = copy_count + 1 WHERE id = ?').run(id)
  } catch {
    // 计数失败不阻塞复制
  }

  // 完整 base_url 也在这里按需下发：列表返回的是遮蔽版（key 形态片段已打码），
  // 「复制 API 地址」时前端来这里取完整值 —— 页面源码全程不含完整 key 形态字符串。
  // 注意这是**与列表的有意差异**：部分站点「URL 即 key」，遮蔽版没有使用价值，
  // 故不能在复制链路上一并遮蔽（`scripts/key-copy-visibility.mjs` 有断言固定该契约）。
  return {
    key_plain: plain || masked,
    base_url: String(row.base_url || ''),
  }
})
