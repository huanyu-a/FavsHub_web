import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const files = process.argv.slice(2)
let bad = 0
for (const f of files) {
  if (!existsSync(f)) { console.log('MISSING FILE:', f); bad++; continue }
  const src = readFileSync(f, 'utf8')
  const re = /from\s+'(\.\.?\/[^']+)'/g
  let m
  while ((m = re.exec(src))) {
    const spec = m[1]
    const base = resolve(dirname(f), spec)
    const cands = [base + '.ts', base + '.js', join(base, 'index.ts')]
    const hit = cands.find(c => existsSync(c) && statSync(c).isFile())
    if (!hit) { console.log(`✗ ${f}\n     ${spec}  →  ${base}  (未解析到文件)`); bad++ }
  }
}
console.log(bad === 0 ? '\n全部相对导入解析成功' : `\n${bad} 处导入错误`)
process.exit(bad ? 1 : 0)
