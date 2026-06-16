/**
 * GET /api/tdk/promptpro — 获取 PromptPro 页面 TDK 配置
 * 仅在 prompts 页面使用，避免将 promptPro TDK 序列化到全局 payload
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
        'promptproTitle', 'promptproDescription', 'promptproKeywords'
      )`
    ).all() as { key: string; value: string }[]

    const result: Record<string, string> = {}
    for (const { key, value } of rows) {
      result[key] = value || ''
    }

    const tdk = {
      promptproTitle: result.promptproTitle || '',
      promptproDescription: result.promptproDescription || '',
      promptproKeywords: result.promptproKeywords || '',
    }

    _cache = tdk
    _cacheTime = now
    return tdk
  }),
  { maxAge: 300, swr: true },
)
