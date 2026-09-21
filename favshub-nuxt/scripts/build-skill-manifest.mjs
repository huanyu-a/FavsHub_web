#!/usr/bin/env node
/**
 * 生成技能包分发清单 —— `public/skills/favshub-data-ops.json`
 *
 * 背景：技能包真源在仓库顶层 `favshub-data-ops/`，而站点要对外分发它。
 * 二者之间隔着一道构建上下文边界 —— Docker 构建的 context 是 `favshub-nuxt/`，
 * 容器内看不到 `../favshub-data-ops/`。因此清单必须在**本地构建前**生成并入库，
 * 由站点作为静态资源分发。
 *
 * 清单内含每个文件的完整正文与 SHA-256，AI 客户端**一次请求**即可拿到全部
 * 最新文件，无需逐个下载 —— 这是自更新流程能一步完成的前提。
 *
 * 用法：
 *   node scripts/build-skill-manifest.mjs            # 生成（源不存在时跳过，不阻断构建）
 *   node scripts/build-skill-manifest.mjs --check    # 仅校验是否漂移，漂移则 exit 1
 *   SKILL_SRC=/path/to/favshub-data-ops node scripts/build-skill-manifest.mjs
 *
 * 为什么「源不存在时跳过」：容器内构建（Docker）拿不到顶层源目录，
 * 此时保留已入库的清单继续构建，而不是让整个构建失败。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const NUXT_ROOT = resolve(HERE, '..')
const REPO_ROOT = resolve(NUXT_ROOT, '..')

const SKILL_NAME = 'favshub-data-ops'
const SKILL_SRC = process.env.SKILL_SRC
  ? resolve(process.env.SKILL_SRC)
  : join(REPO_ROOT, SKILL_NAME)

const OUT_DIR = join(NUXT_ROOT, 'public', 'skills')
const OUT_FILE = join(OUT_DIR, `${SKILL_NAME}.json`)
/** 服务端可 import 的元信息（不含文件正文）——供 describe 端点暴露技能版本 */
const OUT_TS = join(NUXT_ROOT, 'server', 'utils', 'skill-manifest.ts')

/** 参与分发的文件（按此顺序出现在清单里） */
const TRACKED = ['SKILL.md', 'README.md', 'examples.md', 'CHANGELOG.md', 'LICENSE']

const CHECK_ONLY = process.argv.includes('--check')

/** 从 SKILL.md 的 YAML frontmatter 中取版本号（只做单行匹配，不引入 yaml 依赖） */
function readSkillVersion(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!fm) return null
  const m = /^version:\s*(.+)$/m.exec(fm[1])
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null
}

/** 解析 CHANGELOG.md 为条目数组：## [版本] - 日期 后的 - 列表 */
function parseChangelog(text) {
  if (!text) return []
  const out = []
  const blocks = text.split(/\r?\n(?=##\s)/).slice(1)
  for (const block of blocks) {
    const head = /^##\s+\[?([^\]\s]+)\]?(?:\s*-\s*(.+))?/.exec(block.split(/\r?\n/)[0])
    if (!head) continue
    const items = block.split(/\r?\n/)
      .filter(l => /^\s*[-*]\s+/.test(l))
      .map(l => l.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean)
    out.push({ version: head[1], date: (head[2] || '').trim(), changes: items })
  }
  return out
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function build() {
  if (!existsSync(SKILL_SRC)) {
    console.log(`[skill-manifest] 源目录不存在，跳过生成：${SKILL_SRC}`)
    console.log('[skill-manifest] （容器内构建属预期情况，将沿用已入库的清单）')
    return null
  }

  const files = []
  for (const rel of TRACKED) {
    const abs = join(SKILL_SRC, rel)
    if (!existsSync(abs)) continue
    const buf = readFileSync(abs)
    files.push({
      path: rel,
      bytes: buf.byteLength,
      sha256: sha256(buf),
      content: buf.toString('utf8'),
    })
  }

  const skillMd = files.find(f => f.path === 'SKILL.md')
  if (!skillMd) {
    console.error(`[skill-manifest] 错误：${SKILL_SRC} 下没有 SKILL.md`)
    process.exit(1)
  }

  const version = readSkillVersion(skillMd.content)
  if (!version) {
    console.error('[skill-manifest] 错误：SKILL.md frontmatter 缺少 version 字段')
    process.exit(1)
  }

  const siteVersionPath = join(NUXT_ROOT, 'VERSION')
  const siteVersion = existsSync(siteVersionPath)
    ? readFileSync(siteVersionPath, 'utf8').trim()
    : null

  const changelogFile = files.find(f => f.path === 'CHANGELOG.md')

  return {
    name: SKILL_NAME,
    version,
    generated_at: new Date().toISOString(),
    site_version: siteVersion,
    source: 'https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops',
    install_hint: '把 files 中每个条目按 path 写入技能目录（目录名 favshub-data-ops）即完成安装或更新。',
    changelog: parseChangelog(changelogFile?.content),
    files,
  }
}

const manifest = build()
if (!manifest) process.exit(0)

const serialized = JSON.stringify(manifest, null, 2) + '\n'

if (CHECK_ONLY) {
  if (!existsSync(OUT_FILE)) {
    console.error(`[skill-manifest] 漂移：清单尚未生成 → ${OUT_FILE}`)
    process.exit(1)
  }
  const current = readFileSync(OUT_FILE, 'utf8')
  // 忽略 generated_at：它每次都变，不应触发漂移告警
  const strip = (s) => s.replace(/"generated_at":\s*"[^"]*",?\n?/, '')
  if (strip(current) !== strip(serialized)) {
    const cur = JSON.parse(current)
    const detail = cur.version !== manifest.version
      ? `版本号 ${cur.version} → ${manifest.version}`
      : '文件内容有改动'
    console.error(`[skill-manifest] 漂移：分发的清单与技能包源不一致（${detail}）`)
    console.error('[skill-manifest] 执行 `pnpm skill:manifest` 重新生成后提交')
    process.exit(1)
  }
  console.log(`[skill-manifest] 校验通过：v${manifest.version}（${manifest.files.length} 个文件）`)
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, serialized, 'utf8')

// ─── 同步生成服务端元信息（不含文件正文）──────────────────────
// describe 端点需要告知 AI「当前技能版本是多少、去哪更新」，
// 但不应把 30KB 正文塞进每次 describe 响应。此处只导出元信息。
const tsBody = `/**
 * 自动生成 —— 请勿手工编辑。
 * 由 \`scripts/build-skill-manifest.mjs\` 依据 \`../favshub-data-ops/\` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 \`/api/ai/describe\` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: ${JSON.stringify(manifest.name)},
  version: ${JSON.stringify(manifest.version)},
  site_version: ${JSON.stringify(manifest.site_version)},
  manifest_path: '/skills/${SKILL_NAME}.json',
  source: ${JSON.stringify(manifest.source)},
  latest_changes: ${JSON.stringify(manifest.changelog?.[0]?.changes?.slice(0, 5) ?? [], null, 2)},
} as const
`
writeFileSync(OUT_TS, tsBody, 'utf8')

const total = manifest.files.reduce((n, f) => n + f.bytes, 0)
console.log(`[skill-manifest] 已生成 ${OUT_FILE}`)
console.log(`[skill-manifest] 已生成 ${OUT_TS}`)
console.log(`[skill-manifest]   skill v${manifest.version} · site v${manifest.site_version ?? '?'} · ${manifest.files.length} 个文件 · ${(total / 1024).toFixed(1)} KB`)