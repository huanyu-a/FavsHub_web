/**
 * 静态校验：逐个检查相对导入的**具名导出**在目标文件里是否真实存在。
 * 用于在没有 tsc 的环境下替代类型检查，抓「导入名写错 / 重命名后漏改」类问题。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const files = process.argv.slice(2)
let bad = 0
let checked = 0

for (const f of files) {
  if (!existsSync(f)) { console.log('MISSING FILE:', f); bad++; continue }
  const src = readFileSync(f, 'utf8')
  const re = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'(\.\.?\/[^']+)'/g
  let m
  while ((m = re.exec(src))) {
    const names = m[1]
      .split(',')
      .map(s => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
    const base = resolve(dirname(f), m[2])
    const target = [base + '.ts', base + '.js', join(base, 'index.ts')].find(c => existsSync(c))
    if (!target) continue // 路径问题由 impcheck 覆盖
    const tsrc = readFileSync(target, 'utf8')
    for (const n of names) {
      checked++
      const pats = [
        // export function/const/class/interface/type/enum X
        new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${n}\\b`),
        // export { X } / export type { X } / export { X as Y }
        new RegExp(`export\\s+(?:type\\s+|declare\\s+)?\\{[^}]*\\b${n}\\b`),
        // export default X
        new RegExp(`export\\s+default\\s+${n}\\b`),
      ]
      if (!pats.some(p => p.test(tsrc))) {
        console.log(`✗ ${f}\n     未找到导出 '${n}'  in ${target.replace(/.*favshub-nuxt[\\/]/, '')}`)
        bad++
      }
    }
  }
}
console.log(`\n检查 ${checked} 个具名导入：` + (bad === 0 ? '全部存在' : `${bad} 处缺失`))
process.exit(bad ? 1 : 0)
