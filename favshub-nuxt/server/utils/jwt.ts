/**
 * JWT 工具
 * 密钥来源：环境变量 → 持久化文件 → 自动生成
 */
import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getConfig } from './config'

const SECRET_FILE = join(process.cwd(), 'data', '.jwt-secret')

let _secret: string | null = null

/**
 * 获取或创建 JWT Secret
 */
function loadOrCreateSecret(envSecret?: string): string {
  if (_secret) return _secret

  // 1. 环境变量优先
  if (envSecret) {
    _secret = envSecret
    return _secret
  }

  // 2. 从持久化文件读取
  try {
    if (existsSync(SECRET_FILE)) {
      const saved = readFileSync(SECRET_FILE, 'utf8').trim()
      if (saved.length >= 32) {
        _secret = saved
        return _secret
      }
    }
  } catch { /* 文件读取失败则重新生成 */ }

  // 3. 生成新密钥并持久化
  const newSecret = randomBytes(48).toString('base64')
  try {
    const dir = dirname(SECRET_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(SECRET_FILE, newSecret, { mode: 0o600 })
    console.log('[Auth] 已自动生成 JWT 密钥，存储于 ' + SECRET_FILE)
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
  return jwt.sign(payload, getSecret(), { expiresIn: expiry as any })
}

/**
 * 验证 JWT token，成功返回 payload，失败返回 null
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getSecret()) as JwtPayload
  } catch {
    return null
  }
}
