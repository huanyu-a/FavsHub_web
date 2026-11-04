/**
 * 密钥形态串的识别与脱敏 —— **全站唯一真源**（服务端读/写两侧 + 前端展示共用）
 *
 * ## 背景
 *
 * 2026-11-05 线上实测发现：「福利 Key」表的 `source_title` 里混进了一把完整的
 * 51 字符明文 Key，它随 `GET /api/token-keys` 列表响应下发，并经 SSR 进入页面 HTML。
 * 而同一条记录的 `key_masked` 是掩码形态、`key_plain` 按设计**不进任何列表响应** ——
 * 这条数据绕过了「明文 Key 不进列表」的设计控制。
 *
 * 写入方是**外部爬虫**（经 `POST /api/ai/token-keys` 上报），站点无法保证它以后不再写脏，
 * 所以出口侧必须有**不依赖存量数据是否干净**的兜底 —— 这才叫纵深防御。
 *
 * ## 为什么放在 `utils/`（根目录）而不是 `server/utils/`
 *
 * 规则的消费方横跨两侧：
 *   - **服务端读侧**：`token-keys` 列表/详情、`copy` 端点、AI 通道的读回
 *   - **服务端写侧**：`ai-service` 里「这看起来是不是明文密钥」的上行闸门
 *   - **前端**：`TokenKeyCard` 的 API 地址展示（最后一层防御）
 *
 * 放 `server/utils/` 前端引不到，于是前端原先**自己抄了一份正则** —— 而且抄的是
 * **带宽松分支的旧版**（`m.length <= 18 ? 原样显示 : 掩码`），11–18 字符的短密钥
 * 会被**明文显示**。所以这里同时解决「重复」与「两份规则不一致」两个问题。
 *
 * ## 前缀清单为什么必须是一份
 *
 * 读侧（脱敏）与写侧（闸门）原本各有各的清单，且**读侧更窄**：
 * 读侧只有 9 个前缀，而写侧 `ai-service` 的闸门有 11 个 —— 多出 `AIza`（Google）
 * 与 `ghp_`（GitHub）。后果是：一把 Google API Key 落在 `base_url` / `source_title` 里
 * 时，**闸门认得它、脱敏却不认**，于是明文下发。
 *
 * 实测确认（`redactKeyLike('…AIzaSyD-…')` 原样返回、`ghp_…` 同样）。
 * 「免费额度」这个语境里 Google Key 极常见，所以这不是纸上风险。
 * 2026-11-05 核对生产全量：当时**尚无**窄名单漏掉的形态（0 条），属**潜在**缺口而非现行泄漏 ——
 * 但新数据持续进来（同一会话期间就新增 3 条），故补齐。
 */

/**
 * 需要识别的密钥前缀 —— **唯一清单**。
 *
 * 顺序无关（`sk-` 会在具体变体之后兜底）。含各家常见形态：
 * OpenAI / Anthropic / Google / GitHub / Groq / xAI / Fireworks / HuggingFace /
 * Perplexity / NVIDIA / Cohere / Replicate，以及国内中转站常用的 `sk-` 系。
 */
export const KEY_PREFIXES = [
  'sk-', 'gsk_', 'xai-', 'fw_', 'hf_', 'pplx-', 'nvapi-', 'csk-', 'r8_',
  'AIza', 'ghp_',
] as const

/**
 * 更具体的 `sk-` 变体 —— **只给写侧闸门用**。
 *
 * 闸门要判断「整段是否就是一把密钥」，这些变体让判定更精确。
 * 读侧脱敏不需要它们：通用 `sk-` 已经能命中同样的文本跨度。
 * 单列出来是为了让闸门与脱敏**共用同一份前缀池**，而不是各写各的。
 */
export const KEY_PREFIX_SPECIFIC = [
  'sk-(?:or-v1|ant(?:-api\\d{2})?|proj|svcacct|admin|live|test)-?',
] as const

/** 供两侧拼正则用的前缀交替串（具体变体在前，通用前缀兜底） */
export const KEY_PREFIX_ALTERNATION
  = [...KEY_PREFIX_SPECIFIC, ...KEY_PREFIXES].join('|')

/**
 * 密钥形态匹配源。
 *
 * 前缀前允许再接一段字符：真实数据里密钥常被拼在别的文本后面
 * （实测样例 `v1nvapi-…`、`v1sk-cp-…` —— 多行文本拼接产生的脏数据）。
 */
const KEY_LIKE_SOURCE
  = `[A-Za-z0-9_-]*(?:${KEY_PREFIXES.join('|')})[A-Za-z0-9_-]{8,}`

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
 * 注意与更早实现的差异：旧代码里有一句 `m.length <= 18 ? m : 掩码`，
 * **短于等于 18 字符的命中会被原样放行** —— 那是「短串大概不是真 Key」的猜测，
 * 而 `sk-` + 8 字符就已是一把可用的短 Key。2026-11-05 核对过全量生产数据：
 * 三个字段的命中**全部长于 18 字符（短串命中 0 条）**，所以去掉这条宽松分支
 * 不改变任何现有展示，纯粹是收紧。
 *
 * 该宽松分支在前端那份副本里曾**残留**（`TokenKeyCard.vue`），故前端现在也改为引用本函数。
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