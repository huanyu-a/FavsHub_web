#!/usr/bin/env node
/**
 * 部署后一键验证 —— 把 DEPLOYMENT-STATE.md 的「验证清单」变成可执行脚本。
 *
 * ## 为什么要有这个
 *
 * 那份清单原本是 5 段手敲的 bash。问题在于：
 *   · 人会漏步骤（尤其第 2、3 步要 cd 进目录、跑几十秒）；
 *   · 「期望 200」这种判定要人眼看，看错了也不会有人发现；
 *   · 前一步失败后，后面的步骤照样会跑，最后看到一堆输出却不知道到底过了几条。
 *
 * 这个脚本做三件事：**按顺序跑、逐项判定、任一项失败即非零退出**。
 * 输出沿用本仓库其它套件的风格（✓ / ✗ / 末尾「═══ 结果 ═══」），
 * 便于和其它套件一起看。
 *
 * ## 用法
 *
 *   node scripts/post-deploy-verify.mjs                     # 默认打生产
 *   node scripts/post-deploy-verify.mjs --base https://...  # 指定目标
 *   node scripts/post-deploy-verify.mjs --skip-suites       # 只跑 curl 部分（快）
 *
 * ## 判定口径（与文档一致）
 *
 *   1. /api/health             → 200
 *   2. public-field-matrix     → 通过数 > 0 且 失败数 = 0（跳过要显式报出来）
 *   3. full-deal-row-audit     → 「两行都无」= 0 且 错误 = 0
 *   4. 软 404                  → /collections/<不存在> 必须 404
 *   5. 5 个关键页面            → 全 200
 *
 * ⚠️ 第 2、3 步会真打目标站点（只读），默认对生产跑。
 */

const args = process.argv.slice(2)
function arg(name, def = null) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const BASE = (arg('--base', 'https://hao.bx9y.com.cn') || '').replace(/\/+$/, '')
const SKIP_SUITES = args.includes('--skip-suites')

// 浏览器 UA —— 站点按 UA 做内容协商，默认 curl UA 会拿到 JSON 而非页面
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

let pass = 0
const fails = []
const skips = []

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function status(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: { 'User-Agent': UA }, redirect: opts.redirect || 'manual' })
  return r.status
}

/**
 * 跑一个子套件，返回它的 stdout（失败也返回，由调用方判定）。
 *
 * ⚠️ 两个探针的**参数约定不同**，不能统一传：
 *   · `public-field-matrix.mjs` 用**位置参数**：`node xxx.mjs [baseUrl]`
 *   · `full-deal-row-audit.mjs` 用**具名参数**：`--base <url>`
 * 传错会得到 `Failed to parse URL from --base/api/...` 这种硬错误（实测踩过）。
 * 所以按脚本名决定怎么传，而不是「统一传 --base」。
 */
async function runSuite(script) {
  const { spawn } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const here = dirname(fileURLToPath(import.meta.url))
  const positional = script === 'public-field-matrix.mjs'
  const argv = positional ? [join(here, script), BASE] : [join(here, script), '--base', BASE]
  return await new Promise((resolve) => {
    const p = spawn(process.execPath, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let out = ''
    p.stdout.on('data', (c) => { out += c })
    p.stderr.on('data', (c) => { out += c })
    p.on('close', (code) => resolve({ code, out }))
  })
}

async function main() {
  console.log(`部署后验证 —— 目标 ${BASE}\n`)

  // ── 1) 健康检查 ──────────────────────────────────────────────
  try {
    const s = await status('/api/health')
    check('/api/health', s === 200, `HTTP ${s}`)
  } catch (e) {
    check('/api/health', false, e.message)
  }

  // ── 4) 软 404（先跑，快）─────────────────────────────────────
  try {
    const s = await status('/collections/nonexistent_xyz_post_deploy')
    check('软 404：/collections/<不存在>', s === 404, `HTTP ${s}（期望 404）`)
  } catch (e) {
    check('软 404：/collections/<不存在>', false, e.message)
  }

  // ── 5) 关键页面冒烟 ─────────────────────────────────────────
  const pages = ['/', '/tokens', '/tokens/keys', '/prompts', '/collections']
  const bad = []
  for (const p of pages) {
    try {
      const s = await status(p)
      if (s !== 200) bad.push(`${p}=${s}`)
    } catch (e) { bad.push(`${p}=${e.message}`) }
  }
  check(`关键页面冒烟（${pages.length} 个）`, bad.length === 0, bad.length ? bad.join(', ') : `全 200`)

  // ── 2) 3) 两个只读探针 ──────────────────────────────────────
  if (SKIP_SUITES) {
    skips.push('public-field-matrix（--skip-suites）')
    skips.push('full-deal-row-audit（--skip-suites）')
    console.log('  · 已跳过两个探针（--skip-suites）')
  } else {
    // public-field-matrix：通过 > 0 且 失败 = 0
    {
      const { code, out } = await runSuite('public-field-matrix.mjs')
      const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/)
      const passed = m ? Number(m[1]) : 0
      const failed = m ? Number(m[2]) : NaN
      // 「跳过」单独统计 —— 跳过不等于通过
      const skipped = (out.match(/跳过\s*(\d+)/) || [])[1]
      check(
        'public-field-matrix（公开出口 × 内部字段）',
        code === 0 && passed > 0 && failed === 0,
        m ? `${passed} 通过 / ${failed} 失败${skipped ? ` / ${skipped} 跳过` : ''}` : `无法解析结果（exit ${code}）`,
      )
      if (skipped && Number(skipped) > 0) {
        console.log(`     ⚠ 有 ${skipped} 项被跳过 —— 跳过不等于通过，请查原因`)
      }
    }

    // full-deal-row-audit：两行都无 = 0 且 错误 = 0
    {
      const { code, out } = await runSuite('full-deal-row-audit.mjs')
      const neither = (out.match(/两行都无:\s*(\d+)/) || [])[1]
      const errors = (out.match(/错误:\s*(\d+)/) || [])[1]
      check(
        'full-deal-row-audit（两行可见性回归哨兵）',
        code === 0 && neither === '0' && errors === '0',
        neither !== undefined ? `两行都无 ${neither} / 错误 ${errors}` : `无法解析结果（exit ${code}）`,
      )
    }
  }

  // ── 汇总 ────────────────────────────────────────────────────
  console.log('')
  if (skips.length) console.log(`跳过 ${skips.length} 项：${skips.join('、')}`)
  if (fails.length) {
    console.log(`✗ 失败 ${fails.length} 项：`)
    for (const f of fails) console.log('  - ' + f)
  }
  console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => {
  console.error('执行异常：' + e.message)
  process.exit(1)
})