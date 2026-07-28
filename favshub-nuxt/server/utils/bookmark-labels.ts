/**
 * 书签 label 与 URL 工具
 *
 * label 语义（逗号分隔的标签集合）：
 *   ''                        → 纯公共池（精选集数据源，首页个人列表不显示）
 *   'sync' / 'personal' / …   → 纯个人书签（首页显示，sync 管理生命周期）
 *   'sync,pool' 等含 pool     → 双属性：既是个人书签，又具备公共池身份
 *
 * 判断规则：
 *   个人身份 = label 非空（所有现有 `label != ''` 判断天然兼容，无需改动）
 *   公共池身份 = label 为空 或 标签中含 POOL_TAG
 */

/** 公共池保留标签：与个人标签组合表示"同时进公共池" */
export const POOL_TAG = 'pool'

/** 解析 label 为标签数组（去空白、去空项） */
export function parseLabels(label: string | null | undefined): string[] {
  if (!label) return []
  return label.split(',').map(s => s.trim()).filter(Boolean)
}

/** 是否具备公共池身份（可被精选集引用、upsertPoolBookmark 可更新展示字段） */
export function isPoolBookmark(label: string | null | undefined): boolean {
  if (!label || !label.trim()) return true
  return parseLabels(label).includes(POOL_TAG)
}

/** 是否具备个人身份（首页个人书签列表显示） */
export function hasPersonalLabel(label: string | null | undefined): boolean {
  return parseLabels(label).some(t => t !== POOL_TAG)
}

/** 个人标签部分（剔除 pool 保留标签） */
export function personalLabels(label: string | null | undefined): string[] {
  return parseLabels(label).filter(t => t !== POOL_TAG)
}

/** 为 label 追加 pool 标签（若已是公共池身份则原样返回规范形式） */
export function withPoolLabel(label: string | null | undefined): string {
  const tags = parseLabels(label)
  if (!tags.includes(POOL_TAG)) tags.push(POOL_TAG)
  return tags.join(',')
}

/** 移除 pool 标签（保留个人标签） */
export function withoutPoolLabel(label: string | null | undefined): string {
  return personalLabels(label).join(',')
}

/** SQL 片段：判断 bookmarks 行是否具备公共池身份（含 pool 标签或 label 为空） */
export const SQL_IS_POOL = `(COALESCE(label, '') = '' OR ',' || COALESCE(label, '') || ',' LIKE '%,${POOL_TAG},%')`

/**
 * URL 归一化：trim + 去掉结尾的斜杠
 *   https://chat.deepseek.com/  → https://chat.deepseek.com
 *   https://example.com/a//     → https://example.com/a
 * 避免仅尾 / 差异的 URL 产生重复记录（UNIQUE(user_id, url) 是精确匹配）
 */
export function normalizeUrl(url: string): string {
  let u = (url || '').trim()
  while (u.length > 1 && u.endsWith('/') && !u.endsWith('://')) {
    u = u.slice(0, -1)
  }
  return u
}
