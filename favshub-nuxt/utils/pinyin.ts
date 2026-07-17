/**
 * 拼音搜索工具 — 支持中文、全拼、首字母匹配
 * 依赖 pinyin-pro（已安装）
 */
import { match as pinyinMatch, pinyin } from 'pinyin-pro'

/**
 * 判断查询串是否适合拼音匹配（纯 ASCII 字母/数字）
 */
export function isPinyinQuery(query: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(query)
}

/**
 * 检查 query 是否在 text 中匹配（支持全拼 + 首字母）
 */
export function pinyinSearch(text: string, query: string): boolean {
  if (!text || !query) return false
  const lowerQuery = query.toLowerCase()

  // 1. 普通包含匹配（中文原文、英文子串）
  if (text.toLowerCase().includes(lowerQuery)) return true

  // 2. 拼音匹配：query 是纯字母时才走
  if (!isPinyinQuery(lowerQuery)) return false

  try {
    // 全拼匹配：从任意位置开始匹配
    const fullMatch = pinyinMatch(text, lowerQuery, { precision: 'anywhere' })
    if (fullMatch) return true

    // 首字母匹配：取每个汉字的拼音首字母序列
    const pinyinFirstArr = pinyin(text, { pattern: 'first', type: 'array' }) as string[]
    if (pinyinFirstArr.length > 0) {
      const initialsStr = pinyinFirstArr.join('').toLowerCase()
      if (initialsStr.includes(lowerQuery)) return true
    }
  } catch {
    // 匹配失败时静默降级
  }

  return false
}

/**
 * 对 prompt 数组执行拼音搜索
 * 搜索范围：title, description, content, tags
 */
export function searchPrompts<T extends { title?: string; description?: string; content?: string; tags?: { name?: string }[] }>(
  items: T[],
  query: string
): T[] {
  if (!query) return items
  const q = query.trim().toLowerCase()
  if (!q) return items

  return items.filter(item => {
    const tagNames = (item.tags || []).map(t => t.name || '').join(' ')
    const haystack = [item.title, item.description, item.content, tagNames]
      .filter(Boolean)
      .join(' ')
    return pinyinSearch(haystack, q)
  })
}
