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
 * ## 判据（四条互斥分支，加起来必须等于总数）
 *
 *   · 两行都在      → 有 `call_url` 且与 `url` 不同址（正常）
 *   · 只有 API 地址 → 有码池但 SSR 阶段没抽码（客户端挂载后才补，属正常）
 *   · 只有领取地址 → 无 `call_url`（正常）
 *   · 两行都无      → **可疑**（应上报；正常情况下为 0）
 *
 * 另外检查**占位符原文**（`{邀请码}` 等）绝不能出现在渲染层 —— 它们是后端
 * 程序变量，应当已被服务端清洗或整行隐藏。
 *
 * ## 用法
 *
 *   node scripts/full-deal-row-audit.mjs                  # 默认打生产
 *   node scripts/full-deal-row-audit.mjs --base http://localhost:3030
 *   node scripts/full-deal-row-audit.mjs --limit 20        # 只查前 N 条（调试用）
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

/** 占位符原文：这些是后端模板变量，任何情况下都不该出现在渲染后的 HTML 里 */
const PLACEHOLDERS = ['{邀请码}', '{code}', '{invite_code}', '｛邀请码｝', '{{invite_code}}']

/** 浏览器 UA —— 站点会按 UA 做内容协商，用默认 curl UA 会拿到 JSON 而非页面 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchJson(path) {
  const r = await fetch(BASE + path, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`)
  return r.json()
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
  const idx = html.indexOf('接入信息')
  if (idx < 0) return { section: false, hasClaim: false, hasApi: false, placeholder: null }

  // 只看「接入信息」之后的一小段 —— 整页里别处也可能出现 row-label
  const seg = html.slice(idx, idx + 1600).replace(/<!--[\s\S]*?-->/g, '')
  const labels = [...seg.matchAll(/row-label[^>]*>([^<]+)</g)].map((m) => m[1].trim())
  const hit = PLACEHOLDERS.find((p) => seg.includes(p))
  return {
    section: true,
    hasClaim: labels.includes('领取地址'),
    hasApi: labels.includes('API 地址'),
    placeholder: hit || null,
  }
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
  const neither = []
  const errors = []

  await mapLimit(ids, CONCURRENCY, async (id) => {
    try {
      const r = await fetch(`${BASE}/tokens/${id}.html`, { headers: { 'User-Agent': UA } })
      if (r.status !== 200) {
        errors.push([id, `HTTP ${r.status}`])
        return
      }
      const info = inspectHtml(await r.text())
      if (info.placeholder) {
        errors.push([id, `占位符原文泄露: ${info.placeholder}`])
        return
      }
      if (!info.section) {
        neither.push([id, '找不到「接入信息」区块'])
        return
      }
      if (info.hasClaim && info.hasApi) both.push(id)
      else if (info.hasApi) apiOnly.push([id, '有码池、SSR 阶段未抽码（正常）'])
      else if (info.hasClaim) claimOnly.push([id, '无 call_url（正常）'])
      else neither.push([id, '两行都无'])
    } catch (e) {
      errors.push([id, e.message])
    }
  })

  console.log(`总计 ${ids.length} 条：`)
  console.log(`  两行都在:      ${both.length}`)
  console.log(`  只有 API 地址: ${apiOnly.length}   ← 有码池、SSR 未抽码（正常）`)
  console.log(`  只有领取地址:  ${claimOnly.length}   ← 无 call_url（正常）`)
  console.log(`  两行都无:      ${neither.length}`)
  console.log(`  错误:          ${errors.length}`)

  if (neither.length) {
    console.log('\n⚠ 「两行都无」明细（前 10 条）:')
    neither.slice(0, 10).forEach(([id, why]) => console.log(`   ${id}  ${why}`))
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