/**
 * 内网地址判定语料回归 —— 直接加载 `server/utils/favicon-download.ts` **真实源码**来跑。
 *
 * 为什么要有这个脚本：
 *   1. 2026-10-30 的 NAT64 词条 `64:ff9b::/96` 写成了 4 字节前缀却按 96 位比较，
 *      `prefix[4..11]` 恒为 `undefined` → 整个词条**永远返回 false**，成了死代码，
 *      而当时所有测试仍是全绿（因为没人从这条路径走过）。语料回归就是为堵这个口子。
 *   2. 这些函数走不到 HTTP 层（IPv6 字面量会被 `isPrivateHostname` 的冒号检查先拦掉，
 *      NAT64 只有 DNS 路径可达），所以只能在这一层做单元验证。
 *
 * 做法：把源码复制到临时目录并给 `./config` 放一个桩（该模块只从它取一个整数配置，
 * 且只在真正下载时用）。这样跑到的是真实实现，而不是另一份复制粘贴 —— 复制会漂移。
 *
 * 用法：node scripts/private-ip-check.mjs
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'server', 'utils', 'favicon-download.ts')

const dir = mkdtempSync(join(tmpdir(), 'ipcheck-'))
let isPrivateIP, isPrivateHostname
try {
  writeFileSync(join(dir, 'config.ts'), 'export const getConfigInt = (_k: string, d: number) => d\n')
  // 唯一一处改写：把 `from './config'` 补成 `from './config.ts'`。
  // 打包器（Nitro/Vite）允许省略扩展名，Node 的 ESM 解析器不允许；实现本身一字未动。
  const code = readFileSync(SRC, 'utf8').replace("from './config'", "from './config.ts'")
  if (!code.includes("from './config.ts'")) throw new Error('导入改写失败，源码可能已变动')
  writeFileSync(join(dir, 'favicon-download.ts'), code)
  const mod = await import(pathToFileURL(join(dir, 'favicon-download.ts')).href)
  isPrivateIP = mod.isPrivateIP
  isPrivateHostname = mod.isPrivateHostname
} finally {
  // 桩文件读完即可删（模块已加载进内存）
  setTimeout(() => rmSync(dir, { recursive: true, force: true }), 5000)
}

/** 应判为内网/保留 */
const PRIVATE = [
  // ── IPv4 内网与保留段 ──
  '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255',
  '127.0.0.1', '127.1.2.3', '169.254.169.254', '172.16.0.1', '172.31.255.255',
  '192.0.0.1', '192.0.0.255', '192.168.0.1', '192.168.255.255',
  '198.18.0.1', '198.19.255.255',            // 基准测试保留段（fake-ip / 透明代理常用）
  '224.0.0.1', '239.255.255.255',            // 组播
  '240.0.0.1', '255.255.255.255',            // 保留 / 广播
  // ── IPv6 内网与保留段 ──
  '::', '::1', 'fe80::1', 'febf::1', 'fc00::1', 'fd00::1', 'fdff:ffff::1',
  // ── NAT64 64:ff9b::/96（本次修的死代码，内层是内网 IPv4）──
  '64:ff9b::7f00:1',                         // 封装的 127.0.0.1
  '64:ff9b::a00:1',                          // 封装的 10.0.0.1
  '64:ff9b::c0a8:101',                       // 封装的 192.168.1.1
  '64:ff9b::a9fe:a9fe',                      // 封装的 169.254.169.254（云元数据）
  '64:ff9b::7f00:1'.toUpperCase(),
  // ── NAT64 本地用途 64:ff9b:1::/48（RFC 8215）──
  '64:ff9b:1::7f00:1', '64:ff9b:1::a00:1',
  // ── IPv4-mapped（十六进制写法才是真正的坑）──
  '::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:a00:1', '::ffff:c0a8:101', '::ffff:0:0',
  // ── IPv4-compatible ──
  '::7f00:1', '::10.0.0.1',
  // ── 6to4 2002::/16（内层 IPv4）──
  '2002:7f00:1::', '2002:a00:1::', '2002:c0a8:101::',
  // ── 空值（!h 视为内网）与这一条在 IP 判定里特判的云元数据域名 ──
  '', '   ', 'metadata.google.internal',
]

/** 应判为公网（**不得误杀**） */
const PUBLIC = [
  // ── IPv4 公网，含内网段的紧邻边界 ──
  '1.1.1.1', '8.8.8.8', '9.9.9.9', '104.16.0.1', '108.160.172.204',
  '172.15.0.1', '172.32.0.1',                // 172.16/12 的两侧
  '192.0.1.1', '192.169.1.1',                // 192.0.0/24 与 192.168/16 的两侧
  '198.17.0.1', '198.20.0.1',                // 198.18/15 的两侧
  '223.255.255.255', '11.0.0.1', '126.255.255.255', '128.0.0.1',
  '100.63.255.255', '100.128.0.1',           // 100.64/10 的两侧
  // ── IPv6 公网，含内网段边界 ──
  'fe7f::1', 'fec0::1', 'fbff::1', 'fe00::1', // fe80::/10 与 fc00::/7 的两侧
  '2001:db8::1', '2606:4700::1111', '2400:3200::1',
  // ── NAT64 / 6to4 内层是公网 IPv4 时不应误杀 ──
  '64:ff9b::808:808',                        // 封装的 8.8.8.8
  '64:ff9b:1::808:808',
  '2002:808:808::',                          // 6to4 封装的 8.8.8.8
  '::ffff:8.8.8.8', '::ffff:101:101',
  // ── 域名级：旧的 startsWith('fc') 写法会误杀这两个 ──
  'fcorp.com', 'fdic.gov', 'api.openai.com', 'api.deepseek.com', 'github.com',
]

let pass = 0
const fails = []

for (const h of PRIVATE) {
  if (isPrivateIP(h) === true) { pass++ } else { fails.push(`isPrivateIP(${JSON.stringify(h)}) 应为内网，实际 false`) }
}
for (const h of PUBLIC) {
  if (isPrivateIP(h) === false) { pass++ } else { fails.push(`isPrivateIP(${JSON.stringify(h)}) 应为公网，实际 true（误杀）`) }
}

// 域名级判断：IPv6 字面量一律拦掉（fail-closed），普通公网域名放行
const HOSTNAME_CASES = [
  ['localhost', true], ['foo.local', true], ['a.lan', true], ['x.intranet', true],
  ['y.internal', true], ['z.localdomain', true], ['metadata.google.internal', true],
  ['foo.LOCAL', true], ['localhost.', true],
  ['[::1]', true], ['64:ff9b::7f00:1', true], ['::ffff:7f00:1', true],
  ['fcorp.com', false], ['fdic.gov', false], ['api.openai.com', false], ['evil.com', false],
]
for (const [h, want] of HOSTNAME_CASES) {
  if (isPrivateHostname(h) === want) { pass++ } else { fails.push(`isPrivateHostname(${JSON.stringify(h)}) 应为 ${want}，实际 ${!want}`) }
}

console.log(`内网语料 ${PRIVATE.length} 项 + 公网语料 ${PUBLIC.length} 项 + 域名 ${HOSTNAME_CASES.length} 项`)
if (fails.length) {
  console.log(`\n✗ 失败 ${fails.length} 项：`)
  for (const f of fails) console.log('  - ' + f)
  console.log(`\n═══ 结果：${pass} 通过 / ${fails.length} 失败 ═══`)
  process.exit(1)
}
console.log(`\n═══ 结果：${pass} 通过 / 0 失败 ═══`)
