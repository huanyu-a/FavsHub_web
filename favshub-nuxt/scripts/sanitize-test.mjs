/**
 * 出站脱敏单元测试 —— `utils/sanitize.ts`（含 server 转发后的同一实现）
 *
 * 运行：node --experimental-strip-types scripts/sanitize-test.mjs
 *
 * 覆盖三类断言：
 *   1. 必须被抹去 —— 文件系统绝对路径（POSIX / Windows / file://）
 *   2. 必须被保留 —— API 路由、静态资源、域名、业务文案
 *   3. 幂等性 —— 重复处理结果不变
 */
import { redactPaths, safeErrorMessage } from '../utils/sanitize.ts'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  if (actual === expected) {
    pass++
  } else {
    fail++
    console.error(`✗ ${name}\n    期望: ${expected}\n    实际: ${actual}`)
  }
}

function assertContains(name, actual, needle) {
  if (actual.includes(needle)) pass++
  else { fail++; console.error(`✗ ${name}\n    应包含: ${needle}\n    实际: ${actual}`) }
}

function assertNotContains(name, actual, needle) {
  if (!actual.includes(needle)) pass++
  else { fail++; console.error(`✗ ${name}\n    不应包含: ${needle}\n    实际: ${actual}`) }
}

// ─── 1. 必须被抹去 ───────────────────────────────────────────────
check('POSIX 部署路径（含目录+文件）',
  redactPaths("ENOENT: no such file or directory, open '/srv/app/data/favshub.db'"),
  "ENOENT: no such file or directory, open '<path>/favshub.db'")

check('POSIX 纯目录',
  redactPaths('SQLITE_CANTOPEN: unable to open database file at /opt/favshub/data'),
  'SQLITE_CANTOPEN: unable to open database file at <path>/data')

check('Windows 盘符路径（反斜杠）',
  redactPaths('Error: EPERM at C:\\app\\data\\favshub.db'),
  'Error: EPERM at <path>/favshub.db')

check('Windows 盘符路径（正斜杠）',
  redactPaths('读取失败 D:/project/wwwroot/x/y.db'),
  '读取失败 <path>/y.db')

check('file:// URL',
  redactPaths('see file:///www/app/data/db.sqlite for details'),
  'see <path> for details')

check('混合：路径 + 业务文案',
  redactPaths('批量导入失败：/root/.hermes/skills/x 不存在'),
  '批量导入失败：<path>/x 不存在')

// ─── 2. 必须被保留 ───────────────────────────────────────────────
check('API 路由不被误伤',
  redactPaths('GET /api/ai/bookmarks 返回 404'),
  'GET /api/ai/bookmarks 返回 404')

check('静态资源路径不被误伤',
  redactPaths('图标位于 /images/favicons/github.com.png'),
  '图标位于 /images/favicons/github.com.png')

check('管理后台路由不被误伤',
  redactPaths('请前往 /admin/config 修改'),
  '请前往 /admin/config 修改')

check('业务文案原样保留',
  redactPaths('该令牌缺少 write 权限'),
  '该令牌缺少 write 权限')

check('域名与 URL 保留',
  redactPaths('站点 https://hao.bx9y.com.cn/api/ai/stats 可用'),
  '站点 https://hao.bx9y.com.cn/api/ai/stats 可用')

// ─── 3. 幂等性 ──────────────────────────────────────────────────
const once = redactPaths("open '/www/app/data/favshub.db' failed")
check('幂等：二次处理不变', redactPaths(once), once)

// ─── 4. safeErrorMessage ────────────────────────────────────────
check('safeErrorMessage 优先 data.error',
  safeErrorMessage({ data: { error: '参数非法' }, message: '/www/x/y.db boom' }),
  '参数非法')

check('safeErrorMessage 回退 message 并脱敏',
  safeErrorMessage({ message: "open '/www/app/data/favshub.db' failed" }),
  "open '<path>/favshub.db' failed")

check('safeErrorMessage 空对象走 fallback',
  safeErrorMessage({}, '执行失败'),
  '执行失败')

assertNotContains('safeErrorMessage 结果不含物理路径',
  safeErrorMessage({ message: "ENOENT '/srv/app/data/favshub.db'" }),
  '/srv/')

assertContains('safeErrorMessage 保留文件名便于排障',
  safeErrorMessage({ message: "ENOENT '/www/app/data/favshub.db'" }),
  'favshub.db')

// ─── 汇总 ───────────────────────────────────────────────────────
console.log(`\n通过 ${pass} / ${pass + fail}`)
if (fail > 0) {
  console.error(`${fail} 项失败`)
  process.exit(1)
}
console.log('出站脱敏测试全部通过 ✓')
