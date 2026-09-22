/**
 * 测试环境模块解析补丁 —— 补齐裸 Node 与 nitro/vite 的解析差异：
 *   1. 无扩展名相对导入 → 先试 .ts，再试 /index.ts（Node ESM 不做目录解析）
 *   2. nitro 全局包（h3 / #imports 等）→ 映射到本地 stub，使端点模块顶层可求值
 * 仅用于测试，不影响生产代码。
 */
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

const STUB = pathToFileURL(resolvePath(dirname(fileURLToPath(import.meta.url)), 'nitro-stub.mjs')).href
const STUB_PKGS = ['h3', 'nitropack', '#imports', '#app', 'unctx', 'consola']

export async function resolve(specifier, context, next) {
  // 1. nitro 全局包 → stub
  if (STUB_PKGS.some(p => specifier === p || specifier.startsWith(p + '/'))) {
    return { url: STUB, shortCircuit: true }
  }
  // 2. 相对导入补全扩展名 / 目录 index
  if (specifier.startsWith('.')) {
    const parentPath = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd()
    const base = resolvePath(parentPath, specifier)
    if (!/\.(ts|js|mjs|cjs|json)$/.test(specifier)) {
      for (const cand of [base + '.ts', base + '.js', resolvePath(base, 'index.ts')]) {
        if (existsSync(cand) && statSync(cand).isFile()) {
          return { url: pathToFileURL(cand).href, shortCircuit: true }
        }
      }
    }
  }
  return next(specifier, context)
}
