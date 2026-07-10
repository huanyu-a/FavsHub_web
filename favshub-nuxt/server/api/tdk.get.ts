/**
 * GET /api/tdk — 获取站点 TDK 配置（公开接口）
 * 仅返回首页 TDK（siteTitle/siteDescription/siteKeywords）
 * promptPro TDK 通过 /api/tdk/promptpro 单独获取，减少全局 payload
 */
import { getRawDb } from '../database'

// 内存缓存：5 分钟有效，避免每次 SSR 都查库
let _cache: Record<string, string> | null = null
let _cacheTime = 0
const TTL = 5 * 60 * 1000

export function invalidateTdkCache() {
  _cache = null
  _cacheTime = 0
}

export default cachedEventHandler(
  defineEventHandler(() => {
    const now = Date.now()
    if (_cache && now - _cacheTime < TTL) {
      return { ..._cache }
    }

    const db = getRawDb()
    const rows = db.prepare(
      `SELECT key, value FROM system_config WHERE key IN (
        'siteTitle', 'siteDescription', 'siteKeywords', 'baidu_tongji_id', 'baidu_tongji_domains'
      )`
    ).all() as { key: string; value: string }[]

    const result: Record<string, string> = {}
    for (const { key, value } of rows) {
      result[key] = value || ''
    }

    const tdk = {
      siteTitle: result.siteTitle || '',
      siteDescription: result.siteDescription || '',
      siteKeywords: result.siteKeywords || '',
      baiduTongjiId: result.baidu_tongji_id || '',
      baiduTongjiDomains: result.baidu_tongji_domains || '',
    }

    _cache = tdk
    _cacheTime = now
    return tdk
  }),
  { maxAge: 300, swr: true },
)