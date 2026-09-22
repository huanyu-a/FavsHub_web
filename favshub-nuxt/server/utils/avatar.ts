/**
 * 头像与隐私摘要工具 —— QQ 头像代理与不可逆标识的统一实现。
 *
 * ## 为什么需要这一层
 *
 * 需求是「游客填 QQ 号显示 QQ 头像」。若前端直接把 QQ 号拼进 `<img src="qlogo.cn?nk=<QQ号>">`，
 * 则该 QQ 号会**明文出现在页面源码与浏览器网络请求**中 —— 等于把访客的 QQ 号公开关联到其评论。
 * QQ 号是强身份标识（可直接搜索到人），不能这样暴露。
 *
 * 因此本模块把 QQ 号转成**只有服务端能还原的密文令牌**，前端只拿到令牌：
 *
 *   游客填 QQ 号  →  encryptQQ()  →  `qq_cipher` 落库  →  对外只暴露该密文作为头像 URL 路径
 *   GET /avatar/<密文>.jpg  →  decryptQQ()  →  服务端回源 qlogo.cn  →  转发图片字节
 *
 * 页面源码里只有 `u_xxx` 这类不可逆令牌，QQ 号既不出现在 HTML，也不出现在任何 API 响应。
 *
 * ## 设计要点
 *
 * 1. **密钥派生自 JWT secret**（`NUXT_JWT_SECRET`）—— 不新增密钥管理面，随容器重启稳定。
 *    用 HMAC-SHA256 按用途分离（`avatar` / `digest`），互不可推导。
 * 2. **AES-256-GCM**，随机 12 字节 nonce 前置。密文令牌一旦生成即落库，天然稳定，
 *    无需确定性加密 —— 同一 QQ 号同一行数据始终得到同一 URL，缓存友好。
 * 3. **摘要（digest）不可逆** —— `ip_hash` / `fingerprint` 只用于判重，不存明文 IP 与 UA。
 * 4. **QQ 号格式严格校验**（纯数字、5~11 位、首位非 0）—— 既防脏数据，
 *    也**杜绝把用户输入拼进上游 URL 造成 SSRF / 注入**。
 *
 * ⚠️ qlogo 接口对任意输入都返回 200 + 一张图（不存在的号返回默认头像，非数字也返回图），
 *    故**无法校验 QQ 号真伪**，只能做格式约束。这一点在 UI 上要如实告知用户。
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { getSecret } from './jwt'

/** 头像 URL 路径前缀（需与 nuxt.config routeRules、nginx.conf 精确 location 保持一致） */
export const AVATAR_PATH_PREFIX = '/avatar/'

/** 上游 QQ 头像接口（用户指定）：`dst_uin` 换成 QQ 号即可取图 */
const UPSTREAM = 'https://q2.qlogo.cn/headimg_dl'
/** spec=100 实测返回 ~100px JPEG（约 3.9KB），足够评论头像与侧栏头像使用 */
const UPSTREAM_SPEC = '100'
/** 上游超时：超时即返回 404，由前端回退为字母头像，不阻塞页面 */
const UPSTREAM_TIMEOUT_MS = 5000

// ─── 密钥派生 ───────────────────────────────────────────────────

/**
 * 按用途派生 32 字节子密钥。
 *
 * 直接复用 JWT secret 而不做派生也能跑，但那样密文与 token 签名共用同一密钥材料，
 * 一旦某处出现长度扩展类问题会互相牵连；按 label 分离成本极低，隔离收益明确。
 */
function deriveKey(label: string): Buffer {
  return createHmac('sha256', getSecret()).update(`favshub:${label}:v1`).digest()
}

// ─── 不可逆摘要（IP / 指纹判重）──────────────────────────────────

/**
 * 把敏感标识（IP、UA 指纹）转成不可逆摘要。
 *
 * 用途是「同一人同一通告只留一条评测」的判重，不需要也不应该保存明文 IP。
 * 固定 32 位 hex（128 bit），碰撞概率可忽略。
 */
export function digest(value: string): string {
  return createHmac('sha256', deriveKey('digest')).update(value).digest('hex').slice(0, 32)
}

// ─── QQ 号加密 / 解密 ───────────────────────────────────────────

/** QQ 号格式：5~11 位纯数字，首位非 0（实测 qlogo 对非数字输入也返回图，故必须自行约束） */
const QQ_RE = /^[1-9]\d{4,10}$/

export function isValidQQ(value: unknown): value is string {
  return typeof value === 'string' && QQ_RE.test(value)
}

/**
 * 加密 QQ 号为 URL 安全的密文令牌。
 *
 * 输出格式：`base64url(nonce[12] || ciphertext || tag[16])`。
 * 该令牌**同时充当存储值（`qq_cipher`）与公开头像 key**，无需额外映射表。
 *
 * @throws 传入非法 QQ 号时抛错（调用方应先 isValidQQ 校验）
 */
export function encryptQQ(qq: string): string {
  if (!isValidQQ(qq)) {
    throw new Error('QQ 号格式非法')
  }
  const key = deriveKey('avatar')
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(qq, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, body, tag]).toString('base64url')
}

/**
 * 还原密文令牌中的 QQ 号。
 *
 * 任何异常（长度不足、base64 非法、GCM 校验失败、解密结果非合法 QQ 号）一律返回 `null`，
 * **不区分失败原因** —— 避免给攻击者提供「令牌是否存在」的信号，也避免异常冒泡到 HTTP 层。
 */
export function decryptQQ(token: string): string | null {
  try {
    if (!token || token.length < 24 || token.length > 256) return null
    const raw = Buffer.from(token, 'base64url')
    if (raw.length < 12 + 1 + 16) return null
    const nonce = raw.subarray(0, 12)
    const tag = raw.subarray(raw.length - 16)
    const body = raw.subarray(12, raw.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', deriveKey('avatar'), nonce)
    decipher.setAuthTag(tag)
    const qq = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    // GCM 已保证完整性，这里再校验格式：防止历史脏数据或跨用途密钥混用
    return isValidQQ(qq) ? qq : null
  } catch {
    return null
  }
}

// ─── 头像 URL ───────────────────────────────────────────────────

/**
 * 由密文令牌构造站内头像 URL（**不是**上游 qlogo 地址）。
 *
 * 形如 `/avatar/<token>.jpg` —— 扩展名只为让浏览器与 CDN 按图片处理，
 * 实际 `content-type` 由代理端点按上游响应决定。
 */
export function avatarUrl(cipher: string | null | undefined): string | null {
  if (!cipher) return null
  return `${AVATAR_PATH_PREFIX}${cipher}.jpg`
}

/**
 * 从路径参数解析并还原 QQ 号。供头像代理端点使用。
 */
export function qqFromAvatarParam(param: string): string | null {
  const token = param.endsWith('.jpg') ? param.slice(0, -4) : param
  return decryptQQ(token)
}

// ─── 上游取图（带内存缓存）─────────────────────────────────────

interface CacheEntry {
  body: Buffer
  contentType: string
  expiresAt: number
}

/** 上游图片内存缓存：QQ 头像变更频率极低，缓存 6 小时；上限 500 条防止内存无界增长 */
const imageCache = new Map<string, CacheEntry>()
const IMAGE_TTL_MS = 6 * 60 * 60 * 1000
const IMAGE_CACHE_MAX = 500

/**
 * 回源 qlogo 取 QQ 头像。
 *
 * 失败（超时、非 2xx、非图片）返回 `null`，由调用方决定降级策略。
 * QQ 号在此处**已经过 isValidQQ 校验**，拼接进上游 URL 是安全的。
 */
export async function fetchQQAvatar(qq: string): Promise<CacheEntry | null> {
  const hit = imageCache.get(qq)
  if (hit && hit.expiresAt > Date.now()) return hit

  try {
    const res = await fetch(`${UPSTREAM}?dst_uin=${qq}&spec=${UPSTREAM_SPEC}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        // 上游对裸请求可能返回占位图，带上常规浏览器 UA 更稳定
        'User-Agent': 'Mozilla/5.0 (compatible; FavsHub-AvatarProxy/1.0)',
        'Referer': 'https://qzone.qq.com/',
      },
    })
    if (!res.ok) return null

    const contentType = res.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return null

    const body = Buffer.from(await res.arrayBuffer())
    if (body.length === 0 || body.length > 2 * 1024 * 1024) return null

    // 简单的容量控制：超限时清掉最早插入的一条（Map 保持插入序）
    if (imageCache.size >= IMAGE_CACHE_MAX) {
      const oldest = imageCache.keys().next().value
      if (oldest !== undefined) imageCache.delete(oldest)
    }
    const entry: CacheEntry = { body, contentType, expiresAt: Date.now() + IMAGE_TTL_MS }
    imageCache.set(qq, entry)
    return entry
  } catch {
    return null
  }
}

/** 仅供测试/诊断：清空上游图片缓存 */
export function clearAvatarCache(): void {
  imageCache.clear()
}
