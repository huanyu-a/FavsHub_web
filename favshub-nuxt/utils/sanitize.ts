/**
 * 出站脱敏 —— 抹去文本中的文件系统绝对路径。
 *
 * ## 为什么必须在「程序」里做
 *
 * 错误消息由 Node / SQLite / better-sqlite3 抛出，天然携带绝对路径，实测：
 *   `ENOENT: no such file or directory, open 'D:\project\...\data\x.db'`
 * 一旦原样回显给客户端（AI 通道 / 管理后台 / SSR 错误页），部署根路径即外泄。
 *
 * 技能文档（SKILL.md）是**分发给使用者**的文件，可被任意改写，约束力为零 ——
 * 真正的安全边界只能落在代码里。本模块是该边界唯一的实现（前后端共用）。
 *
 * ## 位置说明
 *
 * 放在**根 `utils/`** 而非 `server/utils/`：Nuxt 会把根 utils 自动导入到前端，
 * 使 `error.vue`（SSR 错误页）也能复用同一实现。服务端通过
 * `server/utils/sanitize.ts` 转发，保证**单一真源、无正则漂移**。
 *
 * ## 设计要点
 *
 *   - **不含任何本机真实路径**（本仓库公开），纯模式匹配。
 *   - 只抹「文件系统路径」，**不影响 API 路由**（`/api/ai/bookmarks` 原样保留）。
 *   - 普通路径保留末段（文件名），兼顾脱敏与排障：`<path>/favshub.db`。
 *   - 密钥/凭据类文件名**整段抹净**，连文件名都不留。
 *   - 幂等：已脱敏的文本再次处理结果不变。
 */

/** 替换标记 */
const REDACTED = '<path>'

/**
 * 文件系统根目录**白名单**。
 * 只抹这些前缀开头的路径 —— 这是「不影响 API 路由」的关键：
 * 本站 API 路径（`/api/*`）、静态资源（`/images/*`）均不在此列。
 */
const FS_ROOTS = [
  'www', 'opt', 'root', 'usr', 'var', 'home', 'etc', 'tmp',
  'srv', 'data', 'app', 'proc', 'mnt', 'media', 'Users',
]

/** POSIX 绝对路径：`/www/app/data/db`、`/opt/favshub/.output/server` */
const POSIX_PATH_RE = new RegExp(`/(?:${FS_ROOTS.join('|')})(?:/[\\w.@+-]+)+/?`, 'g')

/**
 * Windows 盘符路径：`C:\app\data\db`、`D:/project/x`
 * 盘符一并吞掉（含 `C:` 本身），避免残留 `C:<path>` 这类可推断形态。
 * 前置 `(?<![A-Za-z0-9])` 防止匹配到 URL 里的 `s:`/`p:` 等。
 */
const WIN_PATH_RE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?:[\w.@+-]+[\\/]?)+/g

/** `file://` URL */
const FILE_URL_RE = /file:\/\/[^\s'"`]+/g

/**
 * 敏感文件名模式 —— 命中则**整段替换**，连文件名都不保留。
 *
 * 普通路径保留末段是为了排障（`favshub.db` 有诊断价值）；
 * 但密钥、凭据类文件名本身就是敏感信息，泄露 `.ssh/id_ed25519_xxx` 的
 * 命名规律对攻击者有直接价值 —— 这类一律抹净。
 */
const SENSITIVE_FILE_RE = /(?:^id_[a-z0-9_]+$|[\w.-]*\.(?:pem|key|p12|pfx)$|^\.env[\w.-]*$|^credentials$|^\.htpasswd$|^authorized_keys$|^known_hosts$|^\.initial-password$)/i

/**
 * 保留路径末段，便于排障：
 * `/www/app/data/favshub.db` → `<path>/favshub.db`
 * 但敏感文件名（密钥/凭据）不保留：`/root/.ssh/id_ed25519_x` → `<path>`
 */
function shorten(match: string): string {
  const parts = match.split(/[\\/]/).filter(Boolean)
  const tail = parts[parts.length - 1] || ''
  // 敏感文件名整段抹净；盘符（`C:`）也不保留
  if (!tail || tail.startsWith('<') || SENSITIVE_FILE_RE.test(tail)) return REDACTED
  return `${REDACTED}/${tail}`
}

/**
 * 抹去文本中的文件系统绝对路径。
 * 非字符串入参会被安全地转为字符串。
 *
 * **顺序敏感**：Windows 盘符路径必须先于 POSIX 路径处理。
 * 否则 `/Users/WIN11/.ssh/key` 会先被 POSIX 规则吃掉，只剩孤立盘符 `C:`，
 * 盘符规则再无机会匹配 → 残留 `C:<path>` 这种仍可推断的形态。
 */
export function redactPaths(input: unknown): string {
  let s = typeof input === 'string' ? input : String(input ?? '')
  if (!s) return s

  s = s.replace(FILE_URL_RE, REDACTED)
  s = s.replace(WIN_PATH_RE, shorten)   // 先：盘符路径（含盘符）
  s = s.replace(POSIX_PATH_RE, shorten) // 后：POSIX 绝对路径
  return s
}

/**
 * 把任意错误对象转为可安全回显的文本。
 *
 * 优先取 `data.error`（业务自写的、可信的消息），否则取 `message`，
 * **无论哪条都过一遍 `redactPaths`** —— 业务消息可能拼接了底层异常。
 */
export function safeErrorMessage(error: any, fallback = '服务器内部错误'): string {
  const raw = error?.data?.error || error?.message || fallback
  return redactPaths(raw)
}
