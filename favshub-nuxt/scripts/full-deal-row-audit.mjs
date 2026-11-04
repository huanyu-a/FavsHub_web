#!/usr/bin/env node
/**
 * 全量通告「两行可见性」审计 —— SSR 渲染层回归哨兵
 *
 * ## 为什么需要它
 *
 * 详情页「接入信息」区块有两行：**领取地址**（`deal.url`，可能含邀请码占位符）
 * 与 **API 地址**（`deal.call_url`）。2026-10-30 发现过一个线上 bug：
 * 「API 地址」行被 `claimSource` 判据误隐藏，**39/46 条可见通告少了这一行**。
 * 修复后需要一条能「对全量数据逐条体检」的回归哨兵 —— 单页断言发现不了
 * 「大部分通告都少一行」这种系统性偏差。
 *
 * ## 判据（五条互斥分支，加起来必须等于总数）
 *
 *   · 两行都在      → 有 `call_url` 且与 `url` 不同址（正常）
 *   · 只有 API 地址 → 有码池但 SSR 阶段没抽码（客户端挂载后才补，属正常）
 *   · 只有领取地址 → 领取行显示的值已经是 `call_url`（不重复显示），或 `call_url` 为空（正常）
 *   · 需抽码·无 API → 有码池且 `call_url` 为空/同为含占位符的模板 → SSR 两行皆空（正常，见下）
 *   · 两行都无      → **可疑**（应上报；正常情况下为 0）
 *
 * 第 4 条是 2026-11-04 补的。原先只按渲染结果分类，于是「SSR 未抽中占位符 → 领取行隐藏；
 * 且 `call_url` 为空、或它自己也是含占位符的模板 → API 行也隐藏」这个组合被错报成「两行都无」。
 * 它**不是**回归：用改动前的镜像跑同一页，「接入信息」区块与线上逐字节同构
 * （同为 `<h4…>接入信息</h4><!----><!----></section>`）。
 *
 * 为什么非要区分：恒亮的假警报会把真信号淹掉，而这正是本脚本存在的理由 ——
 * 当年「39/46 条通告少了 API 地址行」就是没人发现。该组合的判据直接取自组件自身的
 * `claimReady` / `showApiRow` / `apiReady`（`components/tokens/TokenDealDetail.vue:1140-1180`），不是猜的。
 *
 * 另外检查**占位符原文**（`{邀请码}` 等）绝不能出现在渲染层 —— 它们是后端
 * 程序变量，应当已被服务端清洗或整行隐藏。
 *
 * 还有一点：「接入信息」区块**整个拿不到**时归到**错误（无法判定）**，不归「两行都无」——
 * 站点限流/降级时返回的是 200 的「加载失败」壳页面，和「区块被删」在这一层无法区分。
 * 混进「两行都无」会让一次限流伪装成大批内容回归（2026-11-04 实测踩过：连跑 3 轮全量
 * 被限流，62 条全报「找不到区块」）。真出现这种大面积时脚本会额外点名提示。
 *
 * ⚠️ 这不是新问题：`server/plugins/error-handler.ts:27-31` 记录了 2026-10-31 的同类瞬时异常
 * （「61 个详情页同时找不到接入信息区块」，当时是页面 500，事后无任何错误痕迹）。
 * 2026-11-04 此现象**复现**，只是这次响应是 200 + 页内「加载失败」态（`docker logs` 同样干净）。
 * 成因仍未定位；本脚本能做的是「不与内容回归混为一谈」，并留下证据。
 *
 * 并且这种「拿不到内容」会**退避重试**（默认 3 次，`--retries` 可调）后才上报：
 * 站点偶发把详情页渲染成「加载失败」态（同日实测：Node 客户端连发 62 页有 13~22 页中招，
 * 同批 URL 换 curl 并发 30 连发却 0 失败），这种抖动不该把验收打成红的；
 * 而真回归不会因为重试而变绿。每条报错都会带上**页面里实际看到的东西**，便于分辨。
 *
 * ## 用法
 *
 *   node scripts/full-deal-row-audit.mjs                  # 默认打生产
 *   node scripts/full-deal-row-audit.mjs --base http://localhost:3030
 *   node scripts/full-deal-row-audit.mjs --limit 20        # 只查前 N 条（调试用）
 *   node scripts/full-deal-row-audit.mjs --retries 1       # 关掉退避重试（默认 3 次）
 *
 * ## 退出码
 *
 *   0 = 全部通过（两行都无为 0、无错误、无占位符泄露）
 *   1 = 有问题，明细见输出
 *
 * ## 先决条件
 *
 *   只读、只发 GET，不需要 Cookie / PAT。目标站点需可访问。
 *   通告 ID 列表从目标站点自己的 `/api/token-deals?limit=100` 拉取
 *   （不再依赖外部 JSON 文件 —— 那种做法只在原作者机器上能用）。
 */

const args = process.argv.slice(2)
function argOf(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const BASE = argOf('--base', 'https://hao.bx9y.com.cn').replace(/\/+$/, '')
const LIMIT = parseInt(argOf('--limit', '100'), 10) || 100
const CONCURRENCY = parseInt(argOf('--concurrency', '6'), 10) || 6
/**
 * 「拿不到页面内容」时的退避重试次数。
 *
 * 站点偶发把详情页渲染成取数失败态（2026-11-04 实测：本脚本连发 62 页时
 * 有 13~22 页拿到「加载失败」，而同一批 URL 用 curl 并发 30 连发 0 失败）。
 * 那种抖动不该把验收打成红的；真回归不会因为重试而变绿。
 * `--retries 1` 可完全关掉重试。
 */
const RETRIES = Math.max(1, parseInt(argOf('--retries', '3'), 10) || 3)
const RETRY_DELAY_MS = 500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 占位符原文：这些是后端模板变量，任何情况下都不该出现在渲染后的 HTML 里。
 *
 * ⚠️ 判据必须与**真源同形**：`server/utils/invite-codes.ts` 的
 *   `CLAIM_PLACEHOLDER_PATTERN = '[｛{](?:邀请码|code|invite_code)[｝}]'`
 * （`components/tokens/TokenDealDetail.vue:1110` 的 `CLAIM_PLACEHOLDER_RE` 与它同形，
 *  两处刻意共用同一份 pattern「避免漂移」）。这里保持同形 —— 别再退回字面量表：
 * 2026-11-04 独立验证实测，原先的列表漏了「**全角括号 + 拉丁 key**」的 `｛code｝`，
 * 于是**合法**页面会被误报成「两行都无」（方向是误报，偏保守，但它会淹掉真信号）。
 * 半角/全角都认，是因为中文输入法很容易敲出全角 —— 服务端就是这么定的，别比它更窄。
 */
const PLACEHOLDER_RE = /[｛{](?:邀请码|code|invite_code)[｝}]/
/** 历史数据里出现过的双花括号写法，上面的正则覆盖不到，额外兜一层 */
const PLACEHOLDER_LEGACY = ['{{invite_code}}', '{{code}}']

/** 命中则返回占位符原文（用于报错信息），否则 null */
function findPlaceholder(text) {
  const str = String(text || '')
  const m = str.match(PLACEHOLDER_RE)
  if (m) return m[0]
  return PLACEHOLDER_LEGACY.find((p) => str.includes(p)) || null
}

/** 浏览器 UA —— 站点会按 UA 做内容协商，用默认 curl UA 会拿到 JSON 而非页面 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchJson(path) {
  const r = await fetch(BASE + path, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`)
  return r.json()
}

/**
 * 「两行都无」的二次判定：这不可能是从渲染层看出来的 —— 「有没有码池」「原始 url 长什么样」
 * 正是要抽的码被扣住的原因，SSR HTML 里看不到。所以向公开详情接口要一次证据。
 *
 * 返回说明字符串 = 判定为**合法中间态**；返回 null = 仍视为可疑（宁可误报也不放过）。
 * 只有在渲染层两行皆空时才调用，所以正常数据量下每次审计多打 0~1 次请求。
 */
async function explainEmptyRows(id) {
  let d
  try {
    const j = await fetchJson(`/api/token-deals/${encodeURIComponent(id)}`)
    d = j && (j.deal || j)
  } catch {
    return null // 拿不到证据就不替它开脱
  }
  if (!d || typeof d !== 'object') return null

  const callUrl = String(d.call_url || '').trim()
  // ① 领取行的模板里确实还留着未替换的占位符 —— 否则 claimReady 会退回 deal.url，
  //    领取行本该有值，两行皆空就是真问题。
  const claimStillTemplated =
    d.claim_url_has_placeholder === true ||
    findPlaceholder(d.url) !== null
  if (!claimStillTemplated) return null
  // ② API 地址在为空的两种情形下才拿不出来：call_url 为空，或它自己就是含占位符的模板。
  //    若 call_url 有实值（且无占位符），apiReady 应当有值 —— 两行皆空就是要抓的回归。
  const apiUnavailable = !callUrl || findPlaceholder(callUrl) !== null
  if (!apiUnavailable) return null

  return `需抽码（SSR 未抽中）+ ${callUrl ? 'call_url 亦为模板' : 'call_url 为空'} → 两行皆空（正常）`
}

/** 拉取全部可见通告的 id（分页拉，避免 limit 上限截断） */
async function fetchDealIds() {
  const ids = []
  let page = 1
  for (;;) {
    const j = await fetchJson(`/api/token-deals?limit=100&page=${page}`)
    const rows = j.deals || j.token_deals || []
    if (!rows.length) break
    for (const d of rows) if (d && d.id) ids.push(d.id)
    const total = Number(j.pagination?.total ?? j.total ?? 0)
    if (total && ids.length >= total) break
    if (rows.length < 100) break
    page += 1
    if (page > 50) break // 保险丝
  }
  return ids.slice(0, LIMIT)
}

/** 从 SSR HTML 里判断「接入信息」区块渲染了哪几行 */
function inspectHtml(html) {
  // 「接入信息」标题本身出现多次时，indexOf 取到的是**第一个**，可能不是那一块。
  // 实测 61 条通告当前都是唯一（2026-10-31），但这是个「数据一变就失准」的假设，
  // 所以显式报出来，而不是静默按第一个算。
  const occurrences = (html.match(/接入信息/g) || []).length
  const idx = html.indexOf('接入信息')
  if (idx < 0) return { section: false, hasClaim: false, hasApi: false, placeholder: null, ambiguous: false }

  // 只看「接入信息」之后的一小段 —— 整页里别处也可能出现 row-label。
  //
  // 窗口为什么从 1600 放宽到 4000：实测当前最后一个 row-label 距标题最远 781 字符
  // （deal_1793107948617_dpqmn3），余量只有 2 倍。而这两行的值可能是很长的 URL
  // （含 `{邀请码}` 模板、几百字符的查询串），窗口一旦不够就会**漏判成「两行都无」**——
  // 那是本脚本最重要的失败信号，绝不能因为窗口太小而误报。
  // 放宽的代价只是多扫几 KB 字符串，可以忽略。
  const SEG_LEN = 4000
  const seg = html.slice(idx, idx + SEG_LEN).replace(/<!--[\s\S]*?-->/g, '')
  const labels = [...seg.matchAll(/row-label[^>]*>([^<]+)</g)].map((m) => m[1].trim())
  const hit = findPlaceholder(seg)
  return {
    section: true,
    hasClaim: labels.includes('领取地址'),
    hasApi: labels.includes('API 地址'),
    placeholder: hit || null,
    // 标题重复 = 取的可能不是目标区块；调用方据此把该条报成错误而不是当正常数据
    ambiguous: occurrences > 1,
  }
}

/**
 * 页面连「接入信息」区块都没有时，尽量说清**看到的是什么**。
 *
 * 「区块被整段删掉」和「站点取数失败/限流降级」在这一层都表现为「没有这个区块」，
 * 但页面里留下的痕迹能区分：降级态会渲染错误文案。
 * 判不出来就老实说判不出来（而不是替某个猜测背书）—— 2026-11-04 就是靠这条
 * 才发现「42 个页面报两行都无」其实是站点瞬时降级，不是内容回归。
 */
function degradedReason(html) {
  const m = html.match(/(加载失败[^<]{0,30}|超出限频[^<]{0,60}|通告不存在[^<]{0,20}|无权访问[^<]{0,20})/)
  const saw = m ? m[1].replace(/\s+/g, ' ').trim() : ''
  if (saw) return `页面没有「接入信息」区块，且呈现取数失败态：「${saw}」`
  return '页面没有「接入信息」区块（响应里没有错误文案：既可能是限流/降级，也可能是页面结构变了）'
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  async function worker() {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function main() {
  console.log(`目标: ${BASE}`)
  let ids
  try {
    ids = await fetchDealIds()
  } catch (e) {
    console.log(`✗ 拉取通告列表失败: ${e.message}`)
    process.exit(1)
  }
  if (!ids.length) {
    console.log('✗ 没有可见通告可审计（站点为空或接口不可用）')
    process.exit(1)
  }
  console.log(`待审计: ${ids.length} 条可见通告\n`)

  const both = []
  const apiOnly = []
  const claimOnly = []
  const drawOnly = []
  const noSection = []
  const neither = []
  let retried = 0
  const errors = []

  await mapLimit(ids, CONCURRENCY, async (id) => {
    try {
      let info = null
      let why = ''
      for (let attempt = 1; attempt <= RETRIES; attempt++) {
        const r = await fetch(`${BASE}/tokens/${id}.html`, { headers: { 'User-Agent': UA } })
        if (r.status !== 200) {
          why = `HTTP ${r.status}`
          if (attempt < RETRIES && (r.status === 429 || r.status >= 500)) {
            await sleep(RETRY_DELAY_MS * attempt)
            continue
          }
          break
        }
        const html = await r.text()
        const seen = inspectHtml(html)
        if (seen.section) { info = seen; break }
        why = degradedReason(html)
        if (attempt < RETRIES) {
          retried += 1
          await sleep(RETRY_DELAY_MS * attempt)
        }
      }
      if (!info) {
        // 重试后仍拿不到内容：归到「错误（无法判定）」，
        // 别污染「两行都无」这个内容回归信号（见文件头说明）。
        if (!why.startsWith('HTTP')) noSection.push(id)
        errors.push([id, why || '多次尝试后仍拿不到页面内容'])
        return
      }
      if (info.placeholder) {
        errors.push([id, `占位符原文泄露: ${info.placeholder}`])
        return
      }
      // 「接入信息」标题出现多次 → 无法确信取到的是目标区块。
      // 报成 error（不是 neither）：这是**脚本自身的判定不确定**，
      // 混进「两行都无」会让真正的回归信号被假报警淹没。
      if (info.ambiguous) {
        errors.push([id, '页面里「接入信息」出现多次，无法定位目标区块'])
        return
      }
      if (info.hasClaim && info.hasApi) both.push(id)
      else if (info.hasApi) apiOnly.push([id, '有码池、SSR 阶段未抽码（正常）'])
      else if (info.hasClaim) claimOnly.push([id, '领取行已是 call_url（不重复显示）或无 call_url（正常）'])
      else {
        // 渲染层两行皆空：向详情接口要一次证据，看是否属文件头第 4 条判据的合法组合。
        const verdict = await explainEmptyRows(id)
        if (verdict) drawOnly.push([id, verdict])
        else neither.push([id, '两行都无'])
      }
    } catch (e) {
      errors.push([id, e.message])
    }
  })

  console.log(`总计 ${ids.length} 条：`)
  console.log(`  两行都在:      ${both.length}`)
  console.log(`  只有 API 地址: ${apiOnly.length}   ← 有码池、SSR 未抽码（正常）`)
  console.log(`  只有领取地址:  ${claimOnly.length}   ← 领取行已是 call_url（不重复显示）或无 call_url（正常）`)
  console.log(`  需抽码·无 API: ${drawOnly.length}   ← SSR 两行皆空（正常）`)
  console.log(`  两行都无:      ${neither.length}`)
  console.log(`  错误:          ${errors.length}`)
  if (retried) console.log(`  （其中触发退避重试: ${retried} 次 —— 站点瞬时降级，非内容问题）`)

  if (drawOnly.length) {
    // 属正常分支，但仍列出来 —— 判据放宽过的地方最需要留下人工复核的痕迹
    console.log('\n· 「需抽码·无 API」明细（前 10 条，属正常）:')
    drawOnly.slice(0, 10).forEach(([id, why]) => console.log(`   ${id}  ${why}`))
  }
  if (neither.length) {
    console.log('\n⚠ 「两行都无」明细（前 10 条）:')
    neither.slice(0, 10).forEach(([id, why]) => console.log(`   ${id}  ${why}`))
  }
  // 大面积拿不到区块 → 更像被限流/降级。必须点名，否则运维会把它当成
  // 「站点坏了」去回滚（2026-11-04 实测：连跑 3 轮全量后本机 IP 被限流）。
  if (noSection.length >= Math.max(5, Math.ceil(ids.length * 0.2))) {
    console.log(`\n⚠ ${noSection.length}/${ids.length} 个页面连「接入信息」区块都没有 ——`)
    console.log('  这更像目标站限流/降级（或本机 IP 被限），而不是内容回归。')
    console.log('  请先用浏览器确认站点正常、稍等一会儿再重跑；不要据此回滚。')
  }
  if (errors.length) {
    console.log('\n✗ 错误明细（前 10 条）:')
    errors.slice(0, 10).forEach(([id, why]) => console.log(`   ${id}  ${why}`))
  }

  // 判定：两行都无 > 0 或 有错误 → 失败
  const failed = neither.length > 0 || errors.length > 0
  console.log('')
  console.log(failed ? '✗ 审计未通过' : '✓ 审计通过')
  process.exit(failed ? 1 : 0)
}

main()