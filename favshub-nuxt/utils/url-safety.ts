/**
 * URL 安全校验 —— 全站唯一真源
 *
 * ## 这个文件修的是什么
 *
 * 「书签 URL 危险协议」的检查原先散在 **6 处**，每处各抄一份黑名单：
 *
 *   server/api/bookmarks/index.post.ts · server/api/bookmarks/[id].put.ts ·
 *   server/api/admin/bookmarks/[id].put.ts · server/utils/ai-service.ts ·
 *   server/utils/collection-bookmarks.ts · components/bookmark/BookmarkContextMenu.vue
 *
 * 值虽然一致，但那是**巧合**，不是保证 —— 谁给其中一处加个新 scheme，其余五处就是缺口。
 *
 * ## 更要紧的：黑名单本身有绕过
 *
 * 原实现是 `lower.startsWith(s)` 逐条比对黑名单。但按 WHATWG URL 规范，
 * **浏览器在解析 URL 协议前会剥离所有 ASCII tab / 换行 / 回车**（U+0009/000A/000D）。
 * 于是：
 *
 *   `java\tscript:alert(1)`  →  `startsWith('javascript:')` 为 false（放行）
 *                            →  浏览器解析成 `javascript:alert(1)`（执行）
 *
 * 实测确认原实现放行 `java\tscript:` / `java\nscript:` / `java\rscript:` 三种变体，
 * 而 `BookmarkCard.vue` 直接 `:href="bookmark.url"` 渲染 —— 这是一条**存储型 XSS**
 * 路径：payload 先落库，再由每个访客的浏览器打开时执行。
 *
 * 所以本文件做两处修正：
 *
 *   1. **先剥离控制字符再判断**（与浏览器解析口径对齐），堵掉注入变体；
 *   2. **改黑名单为白名单**（只放行 http/https/mailto）——
 *      黑名单永远要穷举「所有危险的东西」，白名单只需守住「我们要的那几个」，
 *      后者在安全上是正确方向。已核对生产全量数据：**2903 条书签全部是
 *      http(102) / https(2801)**，没有一条依赖其它协议，故白名单不误伤存量。
 *
 * ## 为什么放 `utils/`（根目录）
 *
 * 服务端（API / AI 通道）与前端（书签右键菜单）都要用。本文件是**纯函数**，
 * 不 import 任何 DB / Node 内置，可被两侧以同一条路径引用。
 */

/** 放行的协议 —— 白名单，不在此列一律拒绝 */
export const SAFE_URL_SCHEMES = ['http', 'https', 'mailto'] as const

/**
 * 剥离浏览器在解析协议前会忽略的字符。
 *
 * 依据 WHATWG URL 规范：解析前移除所有 ASCII tab（U+0009）、换行（U+000A）、
 * 回车（U+000D），以及首尾的 C0 控制字符与空格。
 * **这是原实现被绕过的地方** —— 不剥这些字符，`java\tscript:` 就匹配不上黑名单。
 */
function stripIgnorableChars(raw: string): string {
  // 1) 先去掉全部 tab / LF / CR（浏览器在协议解析阶段就忽略它们）
  let s = raw.replace(/[\u0009\u000A\u000D]/g, '')
  // 2) 再去首尾空白与 C0 控制字符（0x00–0x20）
  s = s.replace(/^[\u0000-\u0020]+/, '').replace(/[\u0000-\u0020]+$/, '')
  return s
}

/**
 * 取出 URL 的协议（小写，不含冒号）。
 *
 * 返回 `''` 表示没有显式协议 —— 例如 `example.com/x`、`/relative` 这类。
 * 对书签场景而言，无协议值的处理取决于调用方：站点要求书签必须有协议，
 * 但**不要在这里替调用方做这个决定**，只如实报告。
 */
export function urlScheme(url: string | undefined | null): string {
  if (!url) return ''
  const s = stripIgnorableChars(String(url))
  const m = s.match(/^([A-Za-z][A-Za-z0-9+.\-]*):/)
  return m ? m[1]!.toLowerCase() : ''
}

/**
 * URL 是否安全（协议在白名单内）。
 *
 * 语义上这里**等价于**「危险 URL」的反面，但请优先用这个正向函数：
 * 调用方写 `if (!isSafeUrl(u)) reject` 比 `if (isDangerUrl(u)) reject` 更难出错 ——
 * 后者一旦有人把条件写反，危险 URL 就通过了。
 *
 * 注意：无协议值（`''`）视为**不安全**。本函数用于「要落库/要打开的链接」，
 * 那种场景下必须给出明确协议；相对路径不应走这条路径。
 */
export function isSafeUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false
  const scheme = urlScheme(url)
  if (!scheme) return false
  return (SAFE_URL_SCHEMES as readonly string[]).includes(scheme)
}

/**
 * 兼容旧名 —— 原 `collection-bookmarks.ts` 导出的 `isDangerUrl` 语义是
 * 「危险或空值都算危险」，与 `!isSafeUrl()` 完全等价（含 `!url` 分支）。
 * 保留一个薄封装，避免既有调用点全部改写；新代码请直接用 `isSafeUrl`。
 */
export function isDangerUrl(url: string | undefined | null): boolean {
  return !isSafeUrl(url)
}

/** 给用户看的拒绝原因（保持一致文案，别每处自己编一句） */
export const UNSAFE_URL_MESSAGE = '不支持的 URL 协议（仅允许 http / https / mailto）'