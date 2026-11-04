/**
 * GET /api/settings — 获取系统设置和用户偏好
 * 游客：只返回系统设置（过滤敏感字段 + 按值兜底脱敏）
 * 登录用户：系统设置 + 用户偏好覆盖
 *
 * 系统设置（`user_id = 0`）是**所有访客都能拿到**的，所以它是「密钥外泄」的高危出口：
 * 只要有人把密钥写进这里，就会立刻公开。因此除了按名字的 `SENSITIVE_KEYS`，
 * 还有一层**按值**的兜底（见 `scrubSecretValues`）—— 名字可以随便起，值的形态骗不了人。
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'
import { containsKeyLike } from '../../utils/key-redact'

/**
 * 按名字的显式黑名单。
 *
 * **刻意保持为空数组**：不用「名字里含 password/secret/key 就过滤」这种模式匹配 ——
 * 生产 settings 里真实存在 `showPasswordsLink`（扩展的「显示密码链接」开关），
 * 它会被 `password` 模式命中。按名字的模式匹配会误杀正经设置、破坏扩展同步。
 *
 * 判断某个设置是否敏感需要知道**它具体是什么**，所以这里只接受显式登记；
 * 真正兜底的是下面不依赖名字的按值脱敏。
 */
const SENSITIVE_KEYS: string[] = []

/** 命中密钥形态的值会被替换成它 —— 保留键与结构，避免前端因字段消失而报错 */
const REDACTED = '[已脱敏]'

/**
 * 按值脱敏：递归遍历设置值，把**看起来像密钥**的字符串换成占位符。
 *
 * 为什么要这一层：`SENSITIVE_KEYS` 依赖有人记得登记，而密钥往往是**不小心**写进去的。
 * 按值判断不依赖名字，也就不会像名字黑名单那样误伤 `showPasswordsLink`（它的值是布尔）。
 *
 * 对现存数据是 no-op —— 实测生产 settings 出现过的 27 个键，值全是布尔/短字符串，
 * 没有任何一个命中 `containsKeyLike`。它只在真的有人写入密钥时起作用。
 */
function scrubSecretValues(value: any, depth = 0): any {
  if (depth > 6) return value // 防御异常深的嵌套
  if (typeof value === 'string') return containsKeyLike(value) ? REDACTED : value
  if (Array.isArray(value)) return value.map((v) => scrubSecretValues(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = scrubSecretValues(v, depth + 1)
    return out
  }
  return value
}

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  // 获取系统设置 (user_id = 0)
  const sysRow = db.prepare('SELECT data FROM settings WHERE user_id = 0').get() as { data: string } | undefined
  let sysSettings: Record<string, any> = {}
  try {
    sysSettings = sysRow ? JSON.parse(sysRow.data) : {}
  } catch { /* ignore */ }

  // 过滤敏感字段：先按名字摘掉显式登记的，再按值兜底脱敏（两层都要）
  const filteredSys: Record<string, any> = {}
  for (const [k, v] of Object.entries(sysSettings)) {
    if (SENSITIVE_KEYS.includes(k)) continue
    filteredSys[k] = scrubSecretValues(v)
  }

  // 游客直接返回过滤后的系统设置
  if (!user) {
    return { data: filteredSys }
  }

  // 登录用户：合并用户偏好
  const userRow = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(user.id) as { data: string } | undefined
  let userSettings: Record<string, any> = {}
  try {
    userSettings = userRow ? JSON.parse(userRow.data) : {}
  } catch { /* ignore */ }

  // 用户设置覆盖系统设置
  const merged = { ...filteredSys, ...scrubSecretValues(userSettings) }
  return { data: merged }
})
