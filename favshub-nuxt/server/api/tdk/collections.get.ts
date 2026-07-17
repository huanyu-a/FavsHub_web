/**
 * GET /api/tdk/collections — 获取精选集页面 TDK 配置
 * 仅在精选集页面使用，避免将 collections TDK 序列化到全局 payload
 */
import { getRawDb } from '../../database'

let _cache: Record<string, string> | null = null
let _cacheTime = 0
const TTL = 5 * 60 * 1000

export default cachedEventHandler(
  defineEventHandler(() => {
    const now = Date.now()
    if (_cache && now - _cacheTime < TTL) {
      return { ..._cache }
    }

    const db = getRawDb()
    const rows = db.prepare(
      `SELECT key, value FROM system_config WHERE key IN (
        'collectionsTitle', 'collectionsDescription', 'collectionsKeywords'
      )`
    ).all() as { key: string; value: string }[]

    const result: Record<string, string> = {}
    for (const { key, value } of rows) {
      result[key] = value || ''
    }

    const tdk = {
      collectionsTitle: result.collectionsTitle || '',
      collectionsDescription: result.collectionsDescription || '',
      collectionsKeywords: result.collectionsKeywords || '',
    }

    _cache = tdk
    _cacheTime = now
    return tdk
  }),
  { maxAge: 300, swr: true },
)
