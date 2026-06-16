/**
 * 系统配置读取工具
 * 从 system_config 表读取配置，支持类型转换
 */
import { getRawDb } from '../database'
import { SYSTEM_CONFIG_DEFAULTS } from './constants'

/**
 * 获取单个系统配置值（字符串）
 */
export function getConfig(key: string): string {
  try {
    const db = getRawDb()
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? (SYSTEM_CONFIG_DEFAULTS[key] ?? '')
  } catch {
    return SYSTEM_CONFIG_DEFAULTS[key] ?? ''
  }
}

/**
 * 获取系统配置值并转为整数，失败时返回默认值
 */
export function getConfigInt(key: string, fallback: number): number {
  const val = getConfig(key)
  const num = parseInt(val, 10)
  return isNaN(num) ? fallback : num
}

/**
 * 批量获取系统配置
 */
export function getConfigs(keys: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of keys) {
    result[key] = getConfig(key)
  }
  return result
}
