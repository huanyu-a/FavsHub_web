#!/usr/bin/env node
/**
 * 统计各测试套件的断言数，并检查文档里写的数字是否与实测一致。
 *
 * ## 为什么需要它
 *
 * 「CI 断言总计 808」这个数字散落在至少 7 处（`DEPLOYMENT-STATE.md` 的表格与正文、
 * `docker-publish.yml` 的注释）。每次给套件加几条断言，这些数字就同时过期，
 * 而**它们不影响任何测试** —— CI 永远不会因为「文档说 803 实际 808」而报警。
 *
 * 结果就是同类修正已经做过 6 次。人肉维护必然还会错第 7 次，所以改成跑一遍就对。
 *
 * ## 用法
 *
 *   node scripts/assertion-count.mjs           # 只统计并打印
 *   node scripts/assertion-count.mjs --check   # 额外校验文档里的数字，不一致则非零退出
 *
 * 如果本机同时装了多个 Node，build 前的三项（需要 ≥22）会自动找一个 ≥22 的；
 * 找不到，或想指定特定二进制：
 *
 *   ASSERTION_COUNT_NODE=/path/to/node22 node scripts/assertion-count.mjs --check
 *
 * （CI 里 `node-version: 22` 且 install/build/run 同版本，无需这个变量。）
 *
 * ⚠️ 不要在本脚本里写死本机绝对路径 —— 第一版曾写死
 *    `/Users/huanyu/projects/tmp/node-v22...`，在 CI 和别人的机器上必然失效。
 *
 * ## 前提（重要）
 *
 * build 后的 5 个套件会 `spawn('node')` 起 `.output/server/index.mjs`，
 * 而 `better-sqlite3` 是原生模块、**ABI 与 Node 大版本绑定**。
 * 因此必须用「构建 `.output` 时所用的那个 Node」来跑，否则会得到误导性的
 * 「应用 30s 内未就绪」（真实原因是 `NODE_MODULE_VERSION` 不匹配）。
 *
 * 本脚本会先探测 `.output` 里原生模块的 ABI，再与当前 Node 的 ABI 比对，
 * **不匹配就直接报错退出**，而不是让你对着一堆「未就绪」猜。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CHECK = process.argv.includes('--check')
// 只核对文档、**不跑任何套件**：从 $ASSERTION_COUNT_FILE（或 ./assertion-count.json）读数字。
// 这是 CI 用的模式 —— CI 里的 7 个套件已经各自跑过一遍，再跑一次纯属浪费。
const CHECK_ONLY = process.argv.includes('--check-only')

// build 前就能跑的自包含套件（不依赖 .output）
const PRE_BUILD = [
  { name: 'private-ip-check', script: 'private-ip-check.mjs', args: [] },
  { name: 'sanitize-test', script: 'sanitize-test.mjs', args: ['--experimental-strip-types'] },
  { name: 'ssrf-pin-check', script: 'ssrf-pin-check.mjs', args: [] },
  // 通告分类单一真源守卫（2026-11-05）：自包含，但要 import utils/deal-categories.ts，
  // 故同样需要 --experimental-strip-types（Node ≥22.6，与 sanitize-test 同）。
  { name: 'category-source-check', script: 'category-source-check.mjs', args: ['--experimental-strip-types'] },
  // 书签图标解析守卫（2026-11-05）：import utils/favicon.ts，同样需要类型剥离。
  // 断言「合法形态放行 / 坏值回落」，覆盖生产实测到的 30 条 404 坏 icon。
  { name: 'favicon-resolve-check', script: 'favicon-resolve-check.mjs', args: ['--experimental-strip-types'] },
]
// build 后需要 .output 的套件
const POST_BUILD = [
  { name: 'second-batch-e2e', script: 'second-batch-e2e.mjs' },
  { name: 'third-batch-notify', script: 'third-batch-notify.mjs' },
  { name: 'third-batch-detail', script: 'third-batch-detail.mjs' },
  { name: 'third-batch-ratelimit', script: 'third-batch-ratelimit.mjs' },
  { name: 'cache-privacy-check', script: 'cache-privacy-check.mjs' },
  // 「福利 Key」复制端点的可见性契约（2026-11-05）：全站唯一下发明文密钥的接口，
  // 此前零覆盖。独占端口 3257。
  { name: 'key-copy-visibility', script: 'key-copy-visibility.mjs' },
  // 管理后台 API 的鉴权面：admin-guard 中间件只管页面，79 个 /api/admin 端点
  // 各自为政 —— 漏一个就是未鉴权的管理员操作（删用户/清提示词/改通告）。
  // 独占端口 3258。
  { name: 'admin-auth-guard', script: 'admin-auth-guard.mjs' },
  // 整个 /api 的「公开面」契约：224 个端点全部以未登录身份打一遍，
  // 2xx 的必须恰好是一张逐个读过源码的白名单（26 个）。
  // 独占端口 3267。
  { name: 'api-public-surface', script: 'api-public-surface.mjs' },
  // 公开面不许漏密钥：种一条真实形态的明文 Key，断言只有 copy 端点能吐出它。
  // 顺带钉住 /api/settings 的按值脱敏，并防止脱敏误杀 showPasswordsLink 这类正常设置。
  // 独占端口 3269。
  { name: 'public-secret-scan', script: 'public-secret-scan.mjs' },
  // 游客订阅的生命周期契约（游客可写 + 能力令牌的面）：token 形态、404 文案一致性、
  // PATCH 白名单、退订、总闸门，以及两个限流键的 IPv6 /64 聚合（含反向对照）。
  // 独占端口 3270。
  { name: 'deal-subscriptions', script: 'deal-subscriptions.mjs' },
  // SSR head 的注入契约：管理员 TDK 与用户可控的标题/摘要都进 head，
  // 一处没转义就是存储型 XSS。判定器自带安全/危险样本自检（判定器写错会永远绿）。
  // 独占端口 3272。
  { name: 'head-injection', script: 'head-injection.mjs' },
  // 把两个「孤儿」AI 套件接进来：它们覆盖 30 个 /api/ai/** 端点与 /api/mcp
  // （PAT 与 JWT 通道隔离、scope 分级、MCP 工具权限、写删与跨用户隔离、dry_run、审计），
  // 但此前不在门禁、不在 CI、不在 package.json —— 从来没有被执行过。
  // 编排器自带两次启服务（常规模式要放宽 AI 配额，--limit 模式要默认配额），独占端口 3210。
  { name: 'ai-api-gate', script: 'ai-api-gate.mjs' },
  { name: 'third-batch-server', script: 'third-batch-server.mjs' },
  // 统一状态机（2026-11-04）：独占端口 3266，与上面各套件的库/端口互不干扰
  { name: 'state-machine', script: 'state-machine.mjs' },
]

/**
 * 探测 `.output` 里的原生模块能否被**当前 Node** 加载。
 *
 * 走过两条弯路，记下来免得再踩：
 *
 *   1. `createRequire(...)('better-sqlite3')` —— **探测不出来**。
 *      它加载的是 JS 包装层，`.node` 二进制要到真正 new Database() 时才 dlopen。
 *      实测 Node 24 下 require 照样“成功”，而实际起服务立刻崩。
 *
 *   2. 从二进制里 `strings | grep NODE_MODULE_VERSION` —— 也没有。
 *      该 .node 被 strip 过，标记字符串不在了。
 *
 *   可行的办法：**在子进程里直接 `process.dlopen()` 那个 .node 文件**。
 *   成功即 ABI 匹配；失败时 V8 会把「需要 ABI N / 当前 ABI M」原样写进报错，
 *   正好是我们想把话说清楚的东西 —— 而不是让人对着「应用 30s 内未就绪」猜。
 */
function detectAbiMismatch() {
  const candidates = [
    join(ROOT, '.output', 'server', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  ]
  const nodeFile = candidates.find((p) => existsSync(p))
  if (!nodeFile) return null

  const r = spawnSync(process.execPath, [
    '-e',
    'try { process.dlopen({ exports: {} }, process.argv[1]); console.log("OK") }' +
    'catch (e) { console.log("ERR " + String(e.message).replace(/\\n/g, " ")) }',
    nodeFile,
  ], { encoding: 'utf8' })

  const out = `${r.stdout || ''}${r.stderr || ''}`
  if (out.includes('OK')) return null

  const want = (out.match(/NODE_MODULE_VERSION (\d+)/) || [])[1]
  const have = (out.match(/This version of Node\.js requires\s+NODE_MODULE_VERSION (\d+)/) || [])[1]
  return { want: want || '?', have: have || process.versions.modules, current: process.versions.modules, raw: out.trim().slice(0, 200) }
}

/**
 * 本机可能装了多个 Node。两类套件对版本的要求**相反**：
 *
 *   · build 前（private-ip / sanitize / ssrf-pin）：
 *       需要 **Node ≥ 22**（`--experimental-strip-types`）。
 *       Node 20 会报 `bad option: --experimental-strip-types`
 *       或 `ERR_UNKNOWN_FILE_EXTENSION`（.ts 无法直接加载）。
 *   · build 后（5 个 e2e）：必须与 `.output` 里原生模块的 ABI 一致，
 *       否则「应用 30s 内未就绪」。
 *
 * 所以不能全程用同一个 node 二进制。这里按 category 各选一个：
 *   - PRE  ：在候选里挑一个 ≥22 的；挑不到就退化为当前 process（并给出警告）。
 *   - POST ：用当前 process（调用者负责保证 ABI 匹配，不匹配已在前面拦下）。
 */
/**
 * 候选 node 二进制。**不要写死本机绝对路径** —— 那在 CI 和别人的机器上必然失效。
 *
 * 来源（按优先级）：
 *   1. `$ASSERTION_COUNT_NODE` —— 显式指定（CI 或特殊环境用）
 *   2. 当前 process.execPath（大多数情况下够用：CI 里 install/build/run 同版本）
 *   3. PATH 里的 `node22` / `node-22` / `node20` / `node-20`（nvm 之类的命名习惯）
 *   4. nvm 的 `~/.nvm/versions/node/v22.*` 里挑一个
 *
 * 注意：只有 build 前的三个套件需要「≥22」；若本机只有 Node 20/24，
 * 而 .output 又正好是 Node 20 构建的，那 build 前的三项就会跑不了 ——
 * 脚本会明确跳过后打印出来，而不是静默漏算。
 */
function nodeCandidates() {
  const list = []
  const push = (p) => { if (p && existsSync(p) && !list.includes(p)) list.push(p) }
  push(process.env.ASSERTION_COUNT_NODE)
  push(process.execPath)
  for (const name of ['node22', 'node-22', 'node24', 'node-24', 'node20', 'node-20']) {
    const r = spawnSync('sh', ['-c', `command -v ${name} 2>/dev/null`], { encoding: 'utf8' })
    push((r.stdout || '').trim() || null)
  }
  // nvm 目录
  const home = process.env.HOME || ''
  if (home) {
    for (const ver of ['v22', 'v24', 'v20']) {
      const r = spawnSync('sh', ['-c', `ls -d ${home}/.nvm/versions/node/${ver}.*/bin/node 2>/dev/null | sort -V | tail -1`], { encoding: 'utf8' })
      push((r.stdout || '').trim() || null)
    }
  }
  return list
}

const NODE_CANDIDATES = nodeCandidates()

function pickNodeForPre() {
  for (const bin of NODE_CANDIDATES) {
    const r = spawnSync(bin, ['-e', 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'])
    if (r.status === 0) return bin
  }
  return null
}

function runSuite(s) {
  return new Promise((resolve) => {
    const bin = s.nodeBin || process.execPath
    const p = spawn(bin, [...(s.args || []), join(ROOT, 'scripts', s.script)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let out = ''
    p.stdout.on('data', (c) => { out += c })
    p.stderr.on('data', (c) => { out += c })
    p.on('close', (code) => resolve({ code, out }))
  })
}

/** 从各种套件的输出里抠出「通过数」 —— 三种格式都认 */
function parsePass(out) {
  let m = out.match(/═══\s*结果：(\d+)\s*通过/)
  if (m) return Number(m[1])
  m = out.match(/通过\s*[:：]\s*(\d+)/)
  if (m) return Number(m[1])
  m = out.match(/通过\s+(\d+)\s+项/)
  if (m) return Number(m[1])
  // sanitize-test 的格式：「通过 17 / 17」
  m = out.match(/通过\s*(\d+)\s*\/\s*\d+/)
  if (m) return Number(m[1])
  m = out.match(/^(\d+)\s*\/\s*(\d+)$/m)
  if (m) return Number(m[1])
  return null
}

async function main() {
  if (CHECK_ONLY) {
    // ── 只核对，不跑套件 ────────────────────────────────────
    const file = process.env.ASSERTION_COUNT_FILE || join(ROOT, 'assertion-count.json')
    if (!existsSync(file)) {
      console.error(
        `✗ 找不到 ${file}\n\n` +
        `  --check-only 需要一个由先前步骤写出的汇总文件。\n` +
        `  在 CI 里，请让每个测试步骤把自己的通过数追加进去；\n` +
        `  或先跑一次 node scripts/assertion-count.mjs 生成它。`,
      )
      process.exit(1)
    }
    let data
    try { data = JSON.parse(readFileSync(file, 'utf8')) }
    catch (e) { console.error(`✗ ${file} 不是合法 JSON：${e.message}`); process.exit(1) }

    const rows = Array.isArray(data?.suites) ? data.suites : []
    const missing = rows.filter((r) => r.pass === null || r.pass === undefined)
    const total = rows.reduce((a, r) => a + (Number(r.pass) || 0), 0)

    console.log(`断言数核对（来源 ${file}）\n`)
    for (const r of rows) {
      console.log(`  ${r.pass === null || r.pass === undefined ? '?' : String(r.pass).padStart(4)} ${r.name}`)
    }
    if (missing.length) {
      console.error(`\n✗ ${missing.length} 个套件没给出通过数：${missing.map((r) => r.name).join('、')}`)
      console.error('  这通常说明该套件在 CI 里挂了 —— 先看它的日志，不要在这里放过。')
      process.exit(1)
    }
    console.log(`\n${'─'.repeat(44)}\n  断言总计：${total}`)
    return checkDocs(total)
  }

  console.log(`断言数统计 —— ${ROOT}\n`)
  console.log(`当前 Node ${process.version}（ABI ${process.versions.modules}）`)

  const mismatch = detectAbiMismatch()
  if (mismatch) {
    console.error(
      `\n✗ .output 的原生模块与当前 Node 不匹配：\n` +
      `    better_sqlite3.node 需要 NODE_MODULE_VERSION ${mismatch.want}\n` +
      `    当前 Node 提供        NODE_MODULE_VERSION ${mismatch.have || mismatch.current}\n\n` +
      `  请用「构建 .output 时所用的那个 Node」重跑本脚本，否则 5 个 build 后套件\n` +
      `  都会报「应用 30s 内未就绪」—— 那是 ABI 不匹配的误导性表征，不是代码坏了。\n` +
      `  常见做法：用 node-version 20 构建就用 node 20 跑，24 构建就用 24 跑。`,
    )
    process.exit(1)
  }

  const rows = []
  let total = 0
  // 失败套件：**必须**让门禁失败。此前只打印「⚠ exit N」就继续往下走，等于把套件失败
  // 当成了通过 —— 而「门禁 exit 0」是本项目唯一的绿灯信号。
  const failedSuites = []

  console.log('\n── build 前（自包含）──────────────────────')
  const preNode = pickNodeForPre()
  if (!preNode) {
    console.log('  ⚠ 本机找不到 Node ≥22 —— build 前三个套件跑不了（需要 --experimental-strip-types）')
  } else if (preNode !== process.execPath) {
    console.log(`  （这三项用 ${preNode} 跑：需要 Node ≥22）`)
  }
  for (const sRaw of PRE_BUILD) {
    const s = { ...sRaw, nodeBin: preNode || process.execPath }
    if (!preNode) { rows.push({ ...s, n: null, code: -1 }); console.log(`  ? ${s.name} — 跳过（无 Node ≥22）`); continue }
    const { code, out } = await runSuite(s)
    const n = parsePass(out)
    rows.push({ ...s, n, code })
    if (code !== 0 || n === null) failedSuites.push({ name: s.name, code, n, out })
    if (n === null) console.log(`  ? ${s.name} — 无法解析（exit ${code}）`)
    else { total += n; console.log(`  ${String(n).padStart(4)} ${s.name}${code ? `  ⚠ exit ${code}` : ''}`) }
  }

  if (existsSync(join(ROOT, '.output', 'server', 'index.mjs'))) {
    console.log('\n── build 后（需 .output）──────────────────')
    for (const s of POST_BUILD) {
      const { code, out } = await runSuite(s)
      const n = parsePass(out)
      rows.push({ ...s, n, code })
      if (code !== 0 || n === null) failedSuites.push({ name: s.name, code, n, out })
      if (n === null) console.log(`  ? ${s.name} — 无法解析（exit ${code}）：${out.trim().split('\n').slice(-2).join(' ').slice(0, 100)}`)
      else { total += n; console.log(`  ${String(n).padStart(4)} ${s.name}${code ? `  ⚠ exit ${code}` : ''}`) }
    }
  } else {
    console.log('\n  （未找到 .output —— 跳过 5 个 build 后套件；请先 pnpm build）')
  }

  console.log(`\n${'─'.repeat(44)}`)
  console.log(`  断言总计：${total}`)
  console.log(`  （ts:check 的具名导入数不计入）`)

  // 套件失败时把它的 ✗ 行打出来 —— 否则「少了一项」这种症状要靠猜才能定位。
  if (failedSuites.length) {
    console.error(`\n✗ ${failedSuites.length} 个套件未通过：`)
    for (const f of failedSuites) {
      console.error(`\n  ── ${f.name}（exit ${f.code}${f.n === null ? '，断言数无法解析' : `，只解析到 ${f.n} 项`}）──`)
      // 各套件的失败明细打印格式不统一（有的是「✗」，有的是缩进后的「- 原因」），
      // 所以按优先级凑：✗ 行 → 「- 」明细行 → 末尾非空行。
      const outLines = String(f.out || '').split('\n')
      const marks = outLines.filter((l) => /✗/.test(l))
      const dashes = outLines.filter((l) => /^\s{2,}[-·]\s+\S/.test(l))
      const tailLines = outLines.filter((l) => l.trim()).slice(-2)
      const picked = [...new Set([...marks, ...dashes, ...tailLines])].slice(0, 12)
      if (picked.length) for (const l of picked) console.error('     ' + l.trim().slice(0, 220))
      else console.error('     （输出里没有可识别的失败行，可能是启动失败/超时）')
    }
  }

  // 把结果落盘，供 `--check-only`（以及 CI 的后续步骤）复用，避免重复跑套件。
  const outFile = process.env.ASSERTION_COUNT_FILE || join(ROOT, 'assertion-count.json')
  try {
    writeFileSync(outFile, JSON.stringify({
      generatedAt: new Date().toISOString(),
      node: process.version,
      total,
      suites: rows.map((r) => ({ name: r.name, pass: r.n, exit: r.code })),
    }, null, 2) + '\n')
    console.log(`  已写入 ${outFile}`)
  } catch (e) {
    console.log(`  ⚠ 无法写 ${outFile}：${e.message}`)
  }

  if (!CHECK) {
    console.log('\n提示：加 --check 可校验文档里写的数字是否与本次实测一致。')
    if (failedSuites.length) process.exit(1)
  }
  const docsOk = checkDocs(total)
  if (failedSuites.length) process.exit(1)
  return docsOk
}

function checkDocs(total) {
  console.log('\n── 校验文档里的数字 ───────────────────────')
  const docs = [
    { path: join(ROOT, 'DEPLOYMENT-STATE.md'), label: 'DEPLOYMENT-STATE.md' },
    { path: join(dirname(ROOT), '.github', 'workflows', 'docker-publish.yml'), label: 'docker-publish.yml' },
  ]
  let bad = 0
  for (const d of docs) {
    if (!existsSync(d.path)) continue
    const text = readFileSync(d.path, 'utf8')
    // 抓「所有声称是总计的数字」。踩过一次坑：原来的正则只认某一种写法，
    // 于是文件里前一处写对了(808)、后一处被改错成 999 时，只校验到前者，
    // **测试照样绿** —— 这比没有校验更危险。
    // 现在把三种常见写法都抓，且**每一处都必须等于实测值**。
    const patterns = [
      /断言总计[^\d]{0,12}(\d{2,4})/g,
      /合计（断言）\*{0,2}\s*\|\s*\*{0,2}(\d{2,4})/g,
      /共\s*\*{0,2}(\d{2,4})\s*项断言/g,
    ]
    const found = []
    for (const re of patterns) {
      for (const m of text.matchAll(re)) found.push({ v: Number(m[1]), at: m.index })
    }
    if (!found.length) { console.log(`  · ${d.label}：未找到总数断言`); continue }
    const uniq = [...new Set(found.map((f) => f.v))]
    for (const t of uniq) {
      const cnt = found.filter((f) => f.v === t).length
      if (t === total) console.log(`  ✓ ${d.label} 写的 ${t} = 实测 ${total}（${cnt} 处）`)
      else { bad += cnt; console.log(`  ✗ ${d.label} 有一处写 ${t}，实测 ${total}（${cnt} 处不符）`) }
    }
  }
  if (bad) {
    console.log(`\n✗ ${bad} 处文档数字与实测不符 —— 请更新后再提交。`)
    process.exit(1)
  }
  console.log('\n✓ 文档数字与实测一致。')
}

main().catch((e) => { console.error('执行异常：' + e.message); process.exit(1) })