/**
 * 密钥形态串的统一脱敏工具
 *
 * 背景（2026-11-05 线上实测发现）：
 *   「福利 Key」表的 `source_title` 里混进了一把完整的 51 字符明文 Key ——
 *   它随 `GET /api/token-keys` 列表响应下发，并经 SSR 进入页面 HTML（实测页面里出现 2 处）。
 *   而同一条记录的 `key_masked` 是掩码形态，`key_plain` 也按设计**不进任何列表响应**，
 *   只由 `GET /api/token-keys/:id/copy` 按需单条下发。
 *   也就是说：这条数据**绕过了「明文 Key 不进列表」这条设计控制**。
 *
 * 为什么不是「把字段清干净就完了」：
 *   写入方是**外部爬虫**（经 `POST /api/ai/token-keys` 上报），站点无法保证它以后不再写脏。
 *   所以出口侧必须有一道**不依赖存量数据是否干净**的兜底 —— 这才叫纵深防御。
 *
 * 为什么单独抽一个文件：
 *   原先这段正则在 `token-keys/index.get.ts` 里只作用于 `base_url`，
 *   `source_title` / `source_url` 没有被覆盖，`copy` 端点与 AI 通道也各有各的写法。
 *   同一规则散在多处正是漂移的温床（本项目 `DEAL_CATEGORIES` 已有前车之鉴），
 *   故收敛成唯一实现，各处引用。
 */

/**
 * 密钥形态匹配。
 *
 * 覆盖各家常见前缀（`sk-` / `gsk_` / `xai-` / `fw_` / `hf_` / `pplx-` / `nvapi-` /
 * `csk-` / `r8_`），前缀后可含 8 个以上的 `[A-Za-z0-9_-]` 字符。
 * 前缀前允许再接一段字符，因为真实数据里密钥常被拼在别的文本后面
 * （实测样例 `v1nvapi-…`、`v1sk-cp-…` —— 是从多行文本拼接产生的脏数据）。
 */
const KEY_LIKE_SOURCE
  = '[A-Za-z0-9_-]*(?:sk-|gsk_|xai-|fw_|hf_|pplx-|nvapi-|csk-|r8_)[A-Za-z0-9_-]{8,}'

/** 全局版：只给 `replace` 用（`/g` 正则带 `lastIndex` 状态，不能拿来 `test`） */
const KEY_LIKE_G = new RegExp(`\\b${KEY_LIKE_SOURCE}`, 'g')

/** 非全局版：只给 `test` 用 —— 避免 `/g` + `test` 的 `lastIndex` 状态陷阱 */
const KEY_LIKE_TEST = new RegExp(`\\b${KEY_LIKE_SOURCE}`)

/** 脱敏后的掩码形态：保留前 6 位与后 4 位，便于人工比对是哪把（不足以还原） */
function maskSecret(m: string): string {
  return `${m.slice(0, 6)}…${m.slice(-4)}`
}

/**
 * 把文本里所有密钥形态串替换成掩码形态。
 *
 * 注意与旧实现的差异：旧代码里有一句 `m.length <= 18 ? m : 掩码`，
 * **短于等于 18 字符的命中会被原样放行** —— 那是「短串大概不是真 Key」的猜测，
 * 而 `sk-` + 8 字符就已是一把可用的短 Key。2026-11-05 核对过全量生产数据：
 * 三个字段的命中**全部长于 18 字符（短串命中 0 条）**，所以去掉这条宽松分支
 * 不会改变任何现有展示，纯粹是收紧。
 */
export function redactKeyLike(text: unknown): string {
  const s = typeof text === 'string' ? text : ''
  if (!s) return ''
  return s.replace(KEY_LIKE_G, maskSecret)
}

/**
 * 文本里是否含密钥形态串 —— 供**入口侧**拒收脏数据用。
 *
 * 与 `redactKeyLike` 共用同一份正则源，避免「拦的规则」与「脱敏的规则」不一致。
 */
export function containsKeyLike(text: unknown): boolean {
  const s = typeof text === 'string' ? text : ''
  if (!s) return false
  return KEY_LIKE_TEST.test(s)
}
