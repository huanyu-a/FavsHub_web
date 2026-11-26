import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import { escapeLike, publicVisibleClause } from '../../utils/token-deals'

const MAX_QUERY_LENGTH = 80
const DEFAULT_GROUP_LIMIT = 6
const MAX_GROUP_LIMIT = 8

type SearchGroup = 'bookmarks' | 'collections' | 'prompts' | 'tokens'

interface SearchResult {
  id: string
  type: 'bookmark' | 'collection' | 'prompt' | 'token'
  title: string
  subtitle: string
  url: string
  external: boolean
  personal: boolean
}

function truncate(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? '').trim()).slice(0, maxLength).join('')
}

function addKeywordConditions(
  params: unknown[],
  fields: string[],
  keywords: string[],
): string {
  const groups: string[] = []
  for (const keyword of keywords) {
    const pattern = `%${escapeLike(keyword)}%`
    groups.push(`(${fields.map(field => `COALESCE(${field}, '') LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    for (let i = 0; i < fields.length; i++) params.push(pattern)
  }
  return groups.length ? ` AND ${groups.join(' AND ')}` : ''
}

function hostname(value: unknown): string {
  try {
    return new URL(String(value ?? '')).hostname
  } catch {
    return ''
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  if (typeof query.q !== 'string') {
    throw createError({ statusCode: 400, data: { error: '请输入搜索关键词' } })
  }

  const q = query.q.replace(/\s+/g, ' ').trim()
  const queryLength = Array.from(q).length
  if (queryLength < 1) {
    throw createError({ statusCode: 400, data: { error: '请输入搜索关键词' } })
  }
  if (queryLength > MAX_QUERY_LENGTH) {
    throw createError({ statusCode: 400, data: { error: `搜索关键词不能超过 ${MAX_QUERY_LENGTH} 个字符` } })
  }

  let limit = DEFAULT_GROUP_LIMIT
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit)) {
      throw createError({ statusCode: 400, data: { error: `结果上限必须是 1–${MAX_GROUP_LIMIT} 的整数` } })
    }
    limit = Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GROUP_LIMIT) {
      throw createError({ statusCode: 400, data: { error: `结果上限必须是 1–${MAX_GROUP_LIMIT} 的整数` } })
    }
  }

  const auth = getAuthRole(event)
  const user = auth?.user ?? null
  const isAdmin = auth?.isAdmin ?? false
  checkRateLimit(`search:${getClientIP(event)}`, 30, 60_000)
  const db = getRawDb()
  const keywords = q.split(' ').filter(Boolean)
  const groups: Record<SearchGroup, SearchResult[]> = {
    bookmarks: [],
    collections: [],
    prompts: [],
    tokens: [],
  }

  if (user) {
    const params: unknown[] = [user.id]
    const keywordSql = addKeywordConditions(
      params,
      ['b.title', 'b.url', 'b.description'],
      keywords,
    )
    params.push(limit)
    const rows = db.prepare(`
      SELECT b.id, b.title, b.url, b.description, f.name AS folder_name
      FROM bookmarks b
      LEFT JOIN folders f ON f.id = b.folder_id AND f.user_id = b.user_id
      WHERE b.user_id = ? AND b.label != ''
      ${keywordSql}
      ORDER BY COALESCE(b.updated_at, b.created_at, 0) DESC, b.id DESC
      LIMIT ?
    `).all(...params) as any[]

    groups.bookmarks = rows.map(row => ({
      id: String(row.id),
      type: 'bookmark',
      title: truncate(row.title || row.url, 160) || '未命名书签',
      subtitle: [hostname(row.url), truncate(row.folder_name, 60), truncate(row.description, 100)]
        .filter(Boolean)
        .join(' · '),
      url: String(row.url || ''),
      external: true,
      personal: true,
    }))
  }

  {
    const params: unknown[] = []
    const keywordSql = addKeywordConditions(params, ['c.name', 'c.description'], keywords)
    params.push(limit)
    const rows = db.prepare(`
      SELECT c.id, c.name, c.description, c.bookmark_count, c.is_official
      FROM collections c
      WHERE c.is_public = 1
      ${keywordSql}
      ORDER BY c.is_official DESC, COALESCE(c.updated_at, c.created_at, 0) DESC, c.id DESC
      LIMIT ?
    `).all(...params) as any[]

    groups.collections = rows.map(row => ({
      id: String(row.id),
      type: 'collection',
      title: truncate(row.name, 160) || '未命名精选集',
      subtitle: [
        row.is_official ? '官方精选集' : '公开精选集',
        `${Math.max(0, Number(row.bookmark_count) || 0)} 条书签`,
        truncate(row.description, 100),
      ].filter(Boolean).join(' · '),
      url: `/collections/${encodeURIComponent(String(row.id))}`,
      external: false,
      personal: false,
    }))
  }

  {
    const params: unknown[] = []
    let visibilitySql = `(p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1))`
    let folderSql = `(p.folder_id IS NULL OR p.folder_id NOT IN (SELECT id FROM locked_chain))`
    if (isAdmin) {
      visibilitySql = '1 = 1'
      folderSql = '1 = 1'
    } else if (user) {
      visibilitySql = `(p.user_id = ? OR ${visibilitySql})`
      params.push(user.id)
      folderSql = `(p.user_id = ? OR ${folderSql})`
      params.push(user.id)
    }

    const keywordSql = addKeywordConditions(
      params,
      ['p.title', 'p.description', 'p.content'],
      keywords,
    )
    params.push(limit)
    const rows = db.prepare(`
      WITH RECURSIVE locked_chain(id) AS (
        SELECT id FROM prompt_folders WHERE login_required = 1
        UNION
        SELECT pf.id
        FROM prompt_folders pf
        INNER JOIN locked_chain lc ON pf.parent_id = lc.id
      )
      SELECT p.id, p.title, p.description, p.user_id, pf.name AS folder_name
      FROM prompts p
      LEFT JOIN prompt_folders pf ON pf.id = p.folder_id
      WHERE p.deleted_at IS NULL
        AND ${visibilitySql}
        AND ${folderSql}
        ${keywordSql}
      ORDER BY COALESCE(p.updated_at, p.created_at, 0) DESC, p.id DESC
      LIMIT ?
    `).all(...params) as any[]

    groups.prompts = rows.map(row => ({
      id: String(row.id),
      type: 'prompt',
      title: truncate(row.title, 160) || '未命名提示词',
      subtitle: [truncate(row.folder_name, 60), truncate(row.description, 120)]
        .filter(Boolean)
        .join(' · '),
      url: `/prompts/${encodeURIComponent(String(row.id))}.html`,
      external: false,
      personal: !!user && Number(row.user_id) === user.id,
    }))
  }

  {
    const params: unknown[] = []
    const publicSql = publicVisibleClause('d', params)
    const keywordSql = addKeywordConditions(
      params,
      ['d.provider', 'd.title', 'd.quota', 'd.summary', 'd.models'],
      keywords,
    )
    params.push(limit)
    const rows = db.prepare(`
      SELECT d.id, d.provider, d.title, d.quota
      FROM token_deals d
      WHERE 1 = 1
        ${publicSql}
        ${keywordSql}
      ORDER BY COALESCE(d.updated_at, d.created_at, 0) DESC, d.id DESC
      LIMIT ?
    `).all(...params) as any[]

    groups.tokens = rows.map(row => ({
      id: String(row.id),
      type: 'token',
      title: truncate(row.title, 160) || 'Token 通告',
      subtitle: [truncate(row.provider, 60), truncate(row.quota, 100)]
        .filter(Boolean)
        .join(' · '),
      url: `/tokens/${encodeURIComponent(String(row.id))}.html`,
      external: false,
      personal: false,
    }))
  }

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Vary', 'Cookie, Authorization')

  return {
    query: q,
    limit,
    total: Object.values(groups).reduce((sum, items) => sum + items.length, 0),
    groups,
  }
})
