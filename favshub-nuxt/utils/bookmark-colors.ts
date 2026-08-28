/**
 * 书签卡片配色缓存 — 按用户合并为单 key `bookmark-colors:{userId}`，
 * 避免每张卡片独立写 localStorage（245+ key，写入阻塞主线程、易触发 QuotaExceededError）。
 *
 * 内存 Map 为单一数据源，localStorage 仅作持久化；写入失败（隐私模式/满额）时静默降级为内存缓存。
 */

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

interface ColorEntry {
  primary: [number, number, number]
  secondary: [number, number, number]
  ts: number
}

// userId -> (bookmarkId -> colors)
const memoryCache = new Map<string, Map<number, ColorEntry>>()

function cacheKey(userId: number | null | undefined): string {
  return `bookmark-colors:${userId ?? 'guest'}`
}

function loadUserMap(userId: number | null | undefined): Map<number, ColorEntry> {
  const key = cacheKey(userId)
  let m = memoryCache.get(key)
  if (m) return m
  m = new Map()
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, ColorEntry>
        if (obj && typeof obj === 'object') {
          for (const [id, val] of Object.entries(obj)) {
            if (val && typeof val === 'object' && 'ts' in val && Number.isFinite(val.ts)) {
              m.set(Number(id), val)
            }
          }
        }
      }
    } catch { /* 损坏数据忽略，回退内存缓存 */ }
  }
  memoryCache.set(key, m)
  return m
}

function persist(userId: number | null | undefined): void {
  const key = cacheKey(userId)
  const m = memoryCache.get(key)
  if (!m) return
  try {
    const obj: Record<string, ColorEntry> = {}
    for (const [id, val] of m) obj[String(id)] = val
    localStorage.setItem(key, JSON.stringify(obj))
  } catch { /* 满额/隐私模式：仅保留内存缓存 */ }
}

/** 读取某书签的配色缓存；过期自动失效 */
export function getBookmarkColor(userId: number | null | undefined, bookmarkId: number): ColorEntry | null {
  const m = loadUserMap(userId)
  const entry = m.get(bookmarkId)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL) {
    m.delete(bookmarkId)
    return null
  }
  return entry
}

/** 写入某书签的配色缓存（合并进单 key 后持久化） */
export function setBookmarkColor(
  userId: number | null | undefined,
  bookmarkId: number,
  colors: Omit<ColorEntry, 'ts'>,
): void {
  const m = loadUserMap(userId)
  m.set(bookmarkId, { ...colors, ts: Date.now() })
  persist(userId)
}
