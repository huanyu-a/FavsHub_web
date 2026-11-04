#!/usr/bin/env node
/**
 * favicon-resolve-check.mjs — 书签图标解析：可渲染形态白名单 + 坏值回落
 *
 * ## 背景（2026-11-05 生产数据实测）
 *
 * `resolveBookmarkIcon` 原先的做法是「icon 非空就原样返回」，不做形态校验。
 * 查生产全量 2667 条 icon，发现三类不该直接渲染的值：
 *
 *   1. **30 条相对路径缺前导斜杠**（`img/<32位hex>.webp`）—— 会被解析成
 *      `/bookmarks/img/xxx.webp`，而 `public/img` 根本不存在，**全部 404**，
 *      用户看到的是坏图标（实测确认 404）；
 *   2. 危险协议（`javascript:` 等）—— `<img src>` 不执行脚本，但仍不该出现在 DOM 里；
 *   3. 未知协议（`file:` / `blob:`）。
 *
 * 修法是「只渲染形态合法的 icon，其余回落代理图标」。本脚本就是这条不变量的
 * 常驻检测器：**合法形态必须放行、坏值必须回落、且回落目标要有意义**。
 *
 * 运行：node --experimental-strip-types scripts/favicon-resolve-check.mjs
 */
import { isRenderableIcon, resolveBookmarkIcon } from '../utils/favicon.ts'

let pass = 0
let fail = 0
function check(name, actual, expected) {
  if (actual === expected) pass++
  else { fail++; console.error(`✗ ${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`) }
}
function ok(name, cond, detail = '') {
  if (cond) pass++
  else { fail++; console.error(`✗ ${name}${detail ? '\n    ' + detail : ''}`) }
}

const DEAL_URL = 'https://github.com/user/repo'
const FALLBACK = '/api/favicon?domain=github.com'

// ── 1. 必须放行的合法形态 ────────────────────────────────────────────
console.log('▶ 合法 icon 形态必须原样放行')
check('站内落盘路径', resolveBookmarkIcon('/images/favicons/github.com.png', DEAL_URL),
  '/images/favicons/github.com.png')
check('站内根路径', resolveBookmarkIcon('/favicon.ico', DEAL_URL), '/favicon.ico')
check('data:image 内联图标（生产有 25 条）',
  resolveBookmarkIcon('data:image/png;base64,iVBORw0KGgo=', DEAL_URL),
  'data:image/png;base64,iVBORw0KGgo=')
check('data:image/svg+xml 也算合法图片类型',
  resolveBookmarkIcon('data:image/svg+xml;utf8,<svg/>', DEAL_URL),
  'data:image/svg+xml;utf8,<svg/>')
check('http(s) 外链（生产有 10 条）',
  resolveBookmarkIcon('https://cdn.example/i.png', DEAL_URL), 'https://cdn.example/i.png')
check('大写协议也认', resolveBookmarkIcon('HTTPS://cdn.example/i.png', DEAL_URL),
  'HTTPS://cdn.example/i.png')
ok('放行值 isRenderableIcon 均为真',
  ['/a.png', 'data:image/png;base64,x', 'https://a/b.png'].every(isRenderableIcon))

// ── 2. 生产实际存在的坏值必须回落 ────────────────────────────────────
console.log('\n▶ 生产坏值必须回落到代理图标（不再渲染成 404）')
// 这条是真实数据形态，来自生产库（30 条同型）
const REAL_BAD = 'img/bb7047fe697daac0afdc900014e63ca8.webp'
check('缺前导斜杠的相对路径（实测 30 条，全部 404）',
  resolveBookmarkIcon(REAL_BAD, DEAL_URL), FALLBACK)
ok('该坏值被判为不可渲染', isRenderableIcon(REAL_BAD) === false)
// 防「顺手补斜杠」：补了也还是 404，不该假装修好
ok('不会被误「补」成 /img/... 而依然指向不存在的文件',
  resolveBookmarkIcon(REAL_BAD, DEAL_URL) !== '/img/bb7047fe697daac0afdc900014e63ca8.webp')

// ── 3. 危险 / 未知协议必须回落 ──────────────────────────────────────
console.log('\n▶ 危险与未知协议必须拒绝')
for (const [label, v] of [
  ['javascript:', 'javascript:alert(1)'],
  ['vbscript:', 'vbscript:msgbox(1)'],
  ['file:', 'file:///etc/passwd'],
  ['blob:', 'blob:https://example.com/u'],
  ['data:text/html（不是图片，不能当图标）', 'data:text/html,<script>alert(1)</script>'],
  ['协议相对 //evil（容易被误当站内路径）', '//evil.example/x.png'],
  ['纯相对路径', 'foo/bar.png'],
  ['空格', '   '],
]) {
  ok(`拒绝 ${label}`, isRenderableIcon(v) === false)
  check(`拒绝 ${label} → 回落代理图标`, resolveBookmarkIcon(v, DEAL_URL), FALLBACK)
}

// ── 4. 空值 / 无 URL 的边界 ─────────────────────────────────────────
console.log('\n▶ 空值与边界')
check('icon 为空 → 按 URL 域名回落', resolveBookmarkIcon('', DEAL_URL), FALLBACK)
check('icon 为 null → 按 URL 域名回落', resolveBookmarkIcon(null, DEAL_URL), FALLBACK)
check('icon 为 undefined → 按 URL 域名回落', resolveBookmarkIcon(undefined, DEAL_URL), FALLBACK)
check('icon 与 url 都空 → null（用首字母占位）', resolveBookmarkIcon('', null), null)
check('icon 空且 url 无 hostname → null', resolveBookmarkIcon('', 'not a url'), null)
// 私网/本机域名不代理（避免把内网地址拼进请求）
check('icon 空且 url 是 localhost → null', resolveBookmarkIcon('', 'http://localhost:3000/x'), null)
check('icon 空且 url 是内网 IP → null', resolveBookmarkIcon('', 'http://192.168.1.1/x'), null)
// 但合法 icon 不受 url 影响：即便 url 是内网也应渲染图标本身
check('合法 icon 优先于 url（不受内网域名影响）',
  resolveBookmarkIcon('/images/favicons/x.png', 'http://localhost:3000/x'),
  '/images/favicons/x.png')

// ── 5. 幂等性：对已回落的结果再解析一次不应变化 ─────────────────────
console.log('\n▶ 幂等性')
{
  const once = resolveBookmarkIcon(REAL_BAD, DEAL_URL)
  const twice = resolveBookmarkIcon(once, DEAL_URL)
  check('对回落结果再解析保持不变', twice, once)
  ok('回落目标是站内代理路径', once.startsWith('/api/favicon?domain='))
}

// ── 汇总 ────────────────────────────────────────────────────────────
console.log(`\n通过 ${pass} / ${pass + fail}`)
if (fail > 0) {
  console.error(`${fail} 项失败`)
  process.exit(1)
}
console.log('书签图标解析检查全部通过 ✓')