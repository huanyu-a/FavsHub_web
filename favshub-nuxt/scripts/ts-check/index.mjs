#!/usr/bin/env node
/**
 * 全仓 TS 相对导入 / 具名导出静态校验
 *
 * 本项目本地无 tsc / eslint（Windows 沙箱），构建又只能靠容器（1~1.5 分钟），
 * 因此用这套脚本在**秒级**抓出「导入路径层级写错」「导入名写错 / 重命名后漏改」类问题 ——
 * 这类错误在裸 Node 下会被 ESM 解析器报成难懂的 "Cannot find module"，
 * 而实际根因往往是相对路径少一层/多一层。
 *
 * 用法:
 *   node scripts/ts-check/index.mjs            # 扫描 server/ 与 utils/
 *   node scripts/ts-check/index.mjs server/api # 只扫指定目录
 *
 * 退出码: 0 全通过 / 1 有失败项
 */
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : ['server', 'utils', 'composables', 'stores']
// fileURLToPath 是跨平台提取目录的正解（比 URL.pathname 少一层盘符 hack）
const HERE = fileURLToPath(new URL('.', import.meta.url))

/** 递归收集 .ts 文件（跳过 node_modules / .output / .nuxt / .workbuddy） */
function collect(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (['node_modules', '.output', '.nuxt', '.workbuddy', 'dist'].includes(name)) continue
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) collect(p, out)
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap(r => collect(resolve(r)))
if (!files.length) {
  console.log('未找到 .ts 文件（检查传入的目录）')
  process.exit(1)
}
console.log(`扫描 ${files.length} 个 .ts 文件（根: ${ROOTS.join(', ')}）\n`)

let failed = false
for (const script of ['check-imports.mjs', 'check-exports.mjs']) {
  console.log(`── ${script} ──`)
  const r = spawnSync(process.execPath, [join(HERE, script), ...files], {
    stdio: 'inherit',
    cwd: process.cwd(),
  })
  if (r.status !== 0) failed = true
  console.log('')
}

process.exit(failed ? 1 : 0)
