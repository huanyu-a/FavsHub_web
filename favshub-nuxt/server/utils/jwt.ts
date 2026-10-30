/**
 * JWT 工具
 * 密钥来源：环境变量 → 持久化文件 → 自动生成
 */
import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getConfig } from './config'

let _secret: string | null = null

/**
 * 已知的公开占位值。
 *
 * 2026-10-30 在生产实测发现：部署副本 compose.yaml 把 NUXT_JWT_SECRET 的默认值写成了
 * please-change-this-to-a-random-string，而 .env 里没有定义该变量 ——
 * 于是容器的签名密钥就是一个**公开可猜的常量**，任何人凭猜测即可伪造管理员令牌
 * （实测用该密钥签出的令牌访问 /api/admin/ 下的接口返回 200，等同站点接管）。
 *
 * 这类事故的根因是「默认值不安全 + 没人会去核对」，光写文档拦不住，所以启动时点出来。
 * 只告警不阻断：宁可带着警告跑，也不要让站点因为一个配置项起不来。
 */
const INSECURE_SECRETS = new Set([
  'please-change-this-to-a-random-string',
  'please-change-me',
  'change-me',
  'changeme',
  'secret',
  'your-secret-key',
])

function warnIfInsecure(secret: string) {
  if (!INSECURE_SECRETS.has(secret.trim().toLowerCase())) return
  console.error(
    '[Auth] !!! NUXT_JWT_SECRET 使用了公开的默认占位值，任何人凭猜测即可伪造登录令牌'
    + '（含管理员令牌），等同于站点被接管。请立刻改为随机值后重启容器。'
  )
}

/**
 * 获取密钥文件路径（延迟计算，避免 module-level process.cwd() 在 Nitro 打包时不可靠）
 */
function getSecretFilePath(): string {
  return join(process.cwd(), 'data', '.jwt-secret')
}

/**
 * 获取或创建 JWT Secret
 */
function loadOrCreateSecret(envSecret?: string): string {
  if (_secret) return _secret

  // 1. 环境变量优先
  if (envSecret) {
    warnIfInsecure(envSecret)
    _secret = envSecret
    return _secret
  }

  const secretFile = getSecretFilePath()

  // 2. 从持久化文件读取
  try {
    if (existsSync(secretFile)) {
      const saved = readFileSync(secretFile, 'utf8').trim()
      if (saved.length >= 32) {
        _secret = saved
        return _secret
      }
    }
  } catch { /* 文件读取失败则重新生成 */ }

  // 3. 生成新密钥并持久化
  const newSecret = randomBytes(48).toString('base64')
  try {
    const dir = dirname(secretFile)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(secretFile, newSecret, { mode: 0o600 })
    console.log('[Auth] 已自动生成 JWT 密钥，存储于 ' + secretFile)
  } catch (err: any) {
    console.warn('[Auth] 无法持久化 JWT 密钥到文件，密钥仅在本次进程有效:', err.message)
  }
  _secret = newSecret
  return _secret
}

export interface JwtPayload {
  id: number
  username: string
}

/**
 * 初始化 JWT 密钥（由 db-init 插件调用）
 */
export function initJwtSecret(envSecret?: string) {
  loadOrCreateSecret(envSecret)
}

/**
 * 获取当前 JWT 密钥
 */
export function getSecret(): string {
  if (!_secret) {
    throw new Error('[JWT] 密钥尚未初始化')
  }
  return _secret
}

/**
 * 签发 JWT token
 */
export function signToken(payload: JwtPayload, expiresIn?: string): string {
  const expiry = expiresIn || getConfig('jwt_token_expiry') || '7d'
  return jwt.sign(payload, getSecret(), { expiresIn: expiry as any, algorithm: 'HS256' })
}

/**
 * 验证 JWT token，成功返回 payload，失败返回 null
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getSecret(), { algorithms: ['HS256'] }) as JwtPayload
  } catch {
    return null
  }
}
