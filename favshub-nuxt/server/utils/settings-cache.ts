/**
 * 用户设置 JSON 解析缓存 — 供高频端点避免每次请求都 JSON.parse(settings.data)
 * M3/A3/P7：search-engines 等端点高频调用；这里缓存解析结果（TTL 很短，避免长时间陈旧），
 * 并在 settings PUT 写入成功后主动失效。
 */

interface CacheEntry {
  data: Record<string, any> | null
  ts: number
}

const cache = new Map<number, CacheEntry>()
const TTL = 2000 // 2 秒，足够吸收高频请求又不至于长时间陈旧

/**
 * 获取用户设置解析结果；未命中时从 DB 读取并解析，写入缓存。
 * @returns 解析后的设置对象；无记录或解析失败返回 null
 */
export function getCachedUserSettings(userId: number, db: any): Record<string, any> | null {
  const now = Date.now()
  const entry = cache.get(userId)
  if (entry && now - entry.ts < TTL) return entry.data

  const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(userId) as { data: string } | undefined
  let data: Record<string, any> | null = null
  if (row) {
    try {
      const parsed = JSON.parse(row.data)
      data = parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      data = null
    }
  }
  cache.set(userId, { data, ts: now })
  return data
}

/** 设置写入后主动失效缓存，确保下次请求读到最新值 */
export function invalidateUserSettingsCache(userId: number) {
  cache.delete(userId)
}
