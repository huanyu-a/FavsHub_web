/**
 * AI 数据操作 Service 层 —— `/api/ai/*` 与 `/api/mcp` 的**唯一**数据操作来源。
 *
 * 设计原则：
 *   1. **不接收 H3Event** —— 只接收 `(db, userId, ...)`，便于 REST 端点与 MCP tools 共用同一实现。
 *   2. **越权硬隔离** —— 所有 SQL 强制 `user_id = ?`；查不到统一返回 **404**（不泄露资源存在性）。
 *   3. **写操作可预演** —— 全部支持 `dry_run: true`，只返回将执行的变更而不落库。
 *   4. **批量有上限** —— 单请求最多 `AI_BATCH_LIMIT` 条，先全量校验再写入（避免部分成功）。
 *   5. **权限语义对齐 Web 端点** —— 非管理员写入强制 `login_required = 1`（私有）；
 *      prompts 只允许操作自己的（不允许 AI 触发管理员内容的审核流程）；
 *      token-deals 管理员发布即上线、普通用户进 pending。
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { createError } from 'h3'
import { normalizeUrl } from './bookmark-labels'
import { validateDealPayload, newDealId, escapeLike } from './token-deals'
import { AI_BATCH_LIMIT } from './ai-auth'
import { parseAdminUsers } from './auth'

type DB = Database.Database

// ─── 通用工具 ───────────────────────────────────────────────────

/** 抛出统一格式的错误（`data.error` + `message` 双写，兼容 error-handler 与前端读取） */
function fail(statusCode: number, message: string): never {
  throw createError({ statusCode, message, data: { error: message } })
}

/**
 * 判断用户是否管理员。
 *
 * **必须与 Web 端 `requireAdmin` / `getAuthRole` 的判定顺序一致**：
 *   1. `NUXT_ADMIN_USERS` 环境变量名单（运维旁路，见 `server/utils/auth.ts`）
 *   2. 数据库 `users.is_admin`
 *
 * 本函数不接收 H3Event（Service 层需被 MCP 复用），故直接读 `process.env`。
 * 这与 Nuxt runtimeConfig 的 `NUXT_ADMIN_USERS` 覆盖来源同一处，语义等价。
 * 若只查库，环境变量管理员会被 AI 通道降级为非管理员（发布通告转 pending、
 * 无法删标签、写入被强制私有），与 Web 端行为不一致。
 */
export function isUserAdmin(db: DB, userId: number): boolean {
  const row = db.prepare('SELECT is_admin, username FROM users WHERE id = ?').get(userId) as
    { is_admin: number; username: string } | undefined
  if (!row) return false
  if (row.is_admin) return true
  return parseAdminUsers(process.env.NUXT_ADMIN_USERS).includes(row.username)
}

/** 把请求体归一化为待处理数组：`{items:[...]}` 或单个对象 */
function toItems(body: any): any[] {
  if (Array.isArray(body?.items)) return body.items
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    // 单个对象：排除仅含 dry_run 的空壳
    const keys = Object.keys(body).filter(k => k !== 'dry_run' && k !== 'confirm')
    if (keys.length === 0) return []
    return [body]
  }
  return []
}

/** 分页参数归一化 */
function paging(query: any, defaultLimit = 100, maxLimit = 500) {
  const limit = Math.max(1, Math.min(maxLimit, Number(query?.limit) || defaultLimit))
  const page = Math.max(1, Number(query?.page) || 1)
  return { limit, page, offset: (page - 1) * limit }
}

/** 校验并归一化整数 ID */
function toId(raw: unknown, label = 'ID'): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) fail(400, `${label} 非法`)
  return n
}

/** 校验文件夹归属（跨用户 → 403；不存在 → 400），与 Web 端点语义一致 */
function assertFolderOwnership(db: DB, userId: number, folderId: unknown) {
  if (folderId == null || folderId === '') return
  const folder = db.prepare('SELECT user_id FROM folders WHERE id = ?').get(folderId) as { user_id: number } | undefined
  if (!folder) fail(400, '目标文件夹不存在')
  if (folder.user_id !== userId) fail(403, '无权写入此文件夹')
}

const DANGER_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:']

/** URL 校验：长度 + 危险协议白名单 */
function assertSafeUrl(url: string, maxLen = 2048) {
  if (url.length > maxLen) fail(400, `URL 最长 ${maxLen} 字符`)
  const lower = url.toLowerCase().trim()
  if (DANGER_SCHEMES.some(s => lower.startsWith(s))) fail(400, '不支持的 URL 协议')
}

// ════════════════════════════════════════════════════════════════
// 书签 bookmarks
// ════════════════════════════════════════════════════════════════

export function listBookmarks(db: DB, userId: number, query: any) {
  const { limit, page, offset } = paging(query)
  const where: string[] = ['b.user_id = ?']
  const params: any[] = [userId]

  if (query?.folder_id !== undefined && query.folder_id !== '' && query.folder_id !== 'all') {
    where.push('b.folder_id = ?')
    params.push(Number(query.folder_id))
  }
  if (query?.label !== undefined && query.label !== '') {
    where.push('b.label = ?')
    params.push(String(query.label))
  }
  if (query?.q) {
    const kw = escapeLike(String(query.q).trim())
    where.push(`(b.title LIKE ? ESCAPE '\\' OR b.url LIKE ? ESCAPE '\\')`)
    params.push(`%${kw}%`, `%${kw}%`)
  }

  const whereSql = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM bookmarks b WHERE ${whereSql}`).get(...params) as { c: number }).c
  const bookmarks = db.prepare(
    `SELECT b.*, f.name AS folder_name FROM bookmarks b
      LEFT JOIN folders f ON b.folder_id = f.id
      WHERE ${whereSql} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset)

  return { bookmarks, pagination: { page, limit, total } }
}

export function createBookmarks(db: DB, userId: number, body: any) {
  const items = toItems(body)
  if (items.length === 0) fail(400, '请求体不能为空：需提供书签字段或 items 数组')
  if (items.length > AI_BATCH_LIMIT) fail(400, `单次最多创建 ${AI_BATCH_LIMIT} 条`)

  const isAdmin = isUserAdmin(db, userId)

  // 先全量校验，再落库 —— 避免部分成功
  const planned = items.map((it: any, i: number) => {
    const title = String(it?.title ?? '').trim()
    const url = String(it?.url ?? '').trim()
    if (!title || !url) fail(400, `第 ${i + 1} 条：title 与 url 均为必填`)
    if (title.length > 256) fail(400, `第 ${i + 1} 条：标题最长 256 字符`)
    assertSafeUrl(url)
    const icon = it?.icon != null ? String(it.icon) : null
    if (icon && icon.length > 2048) fail(400, `第 ${i + 1} 条：图标 URL 最长 2048 字符`)
    const description = String(it?.description ?? '')
    if (description.length > 2000) fail(400, `第 ${i + 1} 条：描述最长 2000 字符`)

    return {
      title,
      url: normalizeUrl(url),
      folder_id: it?.folder_id != null && it.folder_id !== '' ? Number(it.folder_id) : null,
      icon,
      description,
      // 可见性：管理员可自由选择；普通用户强制私有
      login_required: isAdmin ? (it?.login_required ? 1 : 0) : 1,
      // label：'' = 精选集公共池（仅管理员可显式写入），默认个人书签 'web'
      label: typeof it?.label === 'string' ? it.label : 'web',
      need_proxy: it?.need_proxy ? 1 : 0,
    }
  })

  for (const p of planned) assertFolderOwnership(db, userId, p.folder_id)

  if (body?.dry_run === true) {
    return { dry_run: true, planned_count: planned.length, changes: planned }
  }

  const now = Date.now()
  const created: any[] = []
  try {
    db.transaction(() => {
      const ins = db.prepare(
        `INSERT INTO bookmarks
          (user_id, title, url, folder_id, icon, description, sort_order, source, login_required, label, need_proxy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'api', ?, ?, ?, ?, ?)`
      )
      for (const p of planned) {
        // 事务内取 MAX 防并发竞态产生重复 sort_order
        const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM bookmarks WHERE user_id = ?').get(userId) as { m: number | null }
        const r = ins.run(userId, p.title, p.url, p.folder_id, p.icon, p.description,
          (maxOrder?.m || 0) + 1, p.login_required, p.label, p.need_proxy, now, now)
        created.push(db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(r.lastInsertRowid))
      }
    })()
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) {
      fail(409, '该 URL 的书签已存在（同一用户下 URL 唯一）')
    }
    throw err
  }

  return { created, count: created.length }
}

export function updateBookmark(db: DB, userId: number, rawId: unknown, body: any) {
  const id = toId(rawId, '书签 ID')
  const existing = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!existing) fail(404, '书签不存在')

  const isAdmin = isUserAdmin(db, userId)
  const patch: Record<string, any> = {}

  if (body?.title !== undefined) {
    const title = String(body.title).trim()
    if (!title) fail(400, '标题不能为空')
    if (title.length > 256) fail(400, '标题最长 256 字符')
    patch.title = title
  }
  if (body?.url !== undefined) {
    const url = String(body.url).trim()
    if (!url) fail(400, 'URL 不能为空')
    assertSafeUrl(url)
    patch.url = normalizeUrl(url)
  }
  if (body?.description !== undefined) {
    const description = String(body.description)
    if (description.length > 2000) fail(400, '描述最长 2000 字符')
    patch.description = description
  }
  if (body?.icon !== undefined) {
    const icon = body.icon == null ? null : String(body.icon)
    if (icon && icon.length > 2048) fail(400, '图标 URL 最长 2048 字符')
    patch.icon = icon
  }
  if (body?.folder_id !== undefined) {
    const fid = body.folder_id == null || body.folder_id === '' ? null : Number(body.folder_id)
    assertFolderOwnership(db, userId, fid)
    patch.folder_id = fid
  }
  if (body?.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0
  if (body?.label !== undefined) patch.label = typeof body.label === 'string' ? body.label : ''
  if (body?.need_proxy !== undefined) patch.need_proxy = body.need_proxy ? 1 : 0
  if (body?.login_required !== undefined) {
    patch.login_required = isAdmin ? (body.login_required ? 1 : 0) : 1
  }

  if (Object.keys(patch).length === 0) fail(400, '没有提供任何可更新字段')

  if (body?.dry_run === true) {
    return { dry_run: true, target_id: id, changes: patch }
  }

  const now = Date.now()
  const sets = Object.keys(patch).map(k => `${k} = ?`)
  const values = Object.values(patch)
  try {
    db.prepare(`UPDATE bookmarks SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(...values, now, id, userId)
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) {
      fail(409, '该 URL 已被其他书签使用')
    }
    throw err
  }

  return { bookmark: db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) }
}

export function deleteBookmark(db: DB, userId: number, rawId: unknown, body: any) {
  if (body?.confirm !== true) fail(400, '删除操作必须携带 confirm:true')
  const id = toId(rawId, '书签 ID')
  const row = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!row) fail(404, '书签不存在')

  if (body?.dry_run === true) return { dry_run: true, changes: { delete: { id: row.id, title: row.title, url: row.url } } }

  db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(id, userId)
  return { success: true, deleted: { id: row.id, title: row.title } }
}

// ════════════════════════════════════════════════════════════════
// 文件夹 folders
// ════════════════════════════════════════════════════════════════

export function listFolders(db: DB, userId: number, query: any) {
  const where = ['user_id = ?']
  const params: any[] = [userId]
  if (query?.q) {
    where.push(`name LIKE ? ESCAPE '\\'`)
    params.push(`%${escapeLike(String(query.q).trim())}%`)
  }
  const folders = db.prepare(
    `SELECT * FROM folders WHERE ${where.join(' AND ')}
      ORDER BY parent_id NULLS FIRST, sort_order`
  ).all(...params)
  return { folders, count: folders.length }
}

export function createFolder(db: DB, userId: number, body: any) {
  const name = String(body?.name ?? '').trim()
  if (!name) fail(400, '文件夹名称不能为空')
  if (name.length > 128) fail(400, '文件夹名称最长 128 字符')

  const parentId = body?.parent_id != null && body.parent_id !== '' ? Number(body.parent_id) : null
  if (parentId != null) {
    const parent = db.prepare('SELECT user_id FROM folders WHERE id = ?').get(parentId) as { user_id: number } | undefined
    if (!parent) fail(400, '父文件夹不存在')
    if (parent.user_id !== userId) fail(403, '无权在此文件夹下创建子文件夹')
  }

  const isAdmin = isUserAdmin(db, userId)
  const loginRequired = isAdmin ? (body?.login_required ? 1 : 0) : 1
  const icon = body?.icon != null ? String(body.icon) : null

  if (body?.dry_run === true) {
    return { dry_run: true, changes: { name, parent_id: parentId, login_required: loginRequired, icon } }
  }

  const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM folders WHERE user_id = ?').get(userId) as { m: number | null }
  const now = Date.now()
  const r = db.prepare(
    'INSERT INTO folders (user_id, name, parent_id, sort_order, login_required, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, name, parentId, (maxOrder?.m || 0) + 1, loginRequired, icon, now, now)

  return { folder: db.prepare('SELECT * FROM folders WHERE id = ?').get(r.lastInsertRowid) }
}

export function updateFolder(db: DB, userId: number, rawId: unknown, body: any) {
  const id = toId(rawId, '文件夹 ID')
  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!folder) fail(404, '文件夹不存在')

  const patch: Record<string, any> = {}
  if (body?.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) fail(400, '文件夹名称不能为空')
    if (name.length > 128) fail(400, '文件夹名称最长 128 字符')
    patch.name = name
  }
  if (body?.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0
  if (body?.icon !== undefined) patch.icon = body.icon == null ? null : String(body.icon)
  if (body?.login_required !== undefined) patch.login_required = body.login_required ? 1 : 0

  if (body?.parent_id !== undefined) {
    const parentId = body.parent_id == null || body.parent_id === '' ? null : Number(body.parent_id)
    if (parentId != null) {
      const parent = db.prepare('SELECT user_id FROM folders WHERE id = ?').get(parentId) as { user_id: number } | undefined
      if (!parent) fail(400, '目标父文件夹不存在')
      if (parent.user_id !== userId) fail(403, '无权移动至此文件夹')
      // 循环引用检测
      let cur: number | null = parentId
      const visited = new Set<number>([id])
      while (cur !== null) {
        if (visited.has(cur)) fail(400, '不能将文件夹移动到其子文件夹下（循环引用）')
        visited.add(cur)
        const row = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(cur) as { parent_id: number | null } | undefined
        if (!row) break
        cur = row.parent_id
      }
    }
    patch.parent_id = parentId
  }

  if (Object.keys(patch).length === 0) fail(400, '没有提供任何可更新字段')
  if (body?.dry_run === true) return { dry_run: true, target_id: id, changes: patch }

  const sets = Object.keys(patch).map(k => `${k} = ?`)
  db.prepare(`UPDATE folders SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(...Object.values(patch), Date.now(), id, userId)

  return { folder: db.prepare('SELECT * FROM folders WHERE id = ?').get(id) }
}

export function deleteFolder(db: DB, userId: number, rawId: unknown, body: any) {
  if (body?.confirm !== true) fail(400, '删除操作必须携带 confirm:true')
  const id = toId(rawId, '文件夹 ID')
  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!folder) fail(404, '文件夹不存在')

  const affected = (db.prepare('SELECT COUNT(*) AS c FROM bookmarks WHERE folder_id = ?').get(id) as { c: number }).c
  if (body?.dry_run === true) {
    return { dry_run: true, changes: { delete_folder: { id: folder.id, name: folder.name }, affected_bookmarks: affected } }
  }

  // 与 Web 端点语义一致：书签解除归属（不删除），子文件夹上提
  db.transaction(() => {
    db.prepare('UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ?').run(id)
    db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ?').run(folder.parent_id, id)
    db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').run(id, userId)
  })()

  return { success: true, deleted: { id: folder.id, name: folder.name }, detached_bookmarks: affected }
}

// ════════════════════════════════════════════════════════════════
// 提示词 prompts
// ════════════════════════════════════════════════════════════════

export function listPrompts(db: DB, userId: number, query: any) {
  const { limit, page, offset } = paging(query)
  const where: string[] = ['p.user_id = ?', 'p.deleted_at IS NULL']
  const params: any[] = [userId]

  if (query?.folder_id !== undefined && query.folder_id !== '' && query.folder_id !== 'all') {
    where.push('p.folder_id = ?')
    params.push(String(query.folder_id))
  }
  if (query?.favorite === 'true' || query?.favorite === true) where.push('p.is_favorite = 1')
  if (query?.q) {
    const kw = escapeLike(String(query.q).trim())
    where.push(`(p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')`)
    params.push(`%${kw}%`, `%${kw}%`)
  }

  const whereSql = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM prompts p WHERE ${whereSql}`).get(...params) as { c: number }).c
  const prompts = db.prepare(
    `SELECT p.id, p.title, p.description, p.content, p.folder_id, p.is_favorite, p.login_required,
            p.version_count, p.current_version, p.usage_count, p.created_at, p.updated_at
       FROM prompts p WHERE ${whereSql} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[]

  // 附带标签
  for (const p of prompts) {
    p.tags = db.prepare(
      'SELECT t.id, t.name, t.color FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = ?'
    ).all(p.id)
  }

  return { prompts, pagination: { page, limit, total } }
}

export function createPrompt(db: DB, userId: number, body: any) {
  const title = String(body?.title ?? '').trim()
  const content = String(body?.content ?? '')
  if (!title || !content) fail(400, '标题和内容不能为空')
  if (title.length > 256) fail(400, '标题最长 256 字符')
  const description = String(body?.description ?? '')
  if (description.length > 2000) fail(400, '描述最长 2000 字符')
  if (content.length > 100000) fail(400, '内容最长 100000 字符')

  const folderId = body?.folder_id != null && body.folder_id !== '' ? String(body.folder_id) : null
  if (folderId) {
    const folder = db.prepare('SELECT user_id FROM prompt_folders WHERE id = ?').get(folderId) as { user_id: number } | undefined
    if (!folder) fail(400, '目标提示词文件夹不存在')
    if (folder.user_id !== userId) fail(403, '无权写入此文件夹')
  }

  const tags = Array.isArray(body?.tags) ? body.tags.map(String) : []
  const isAdmin = isUserAdmin(db, userId)
  const loginRequired = isAdmin ? (body?.login_required ? 1 : 0) : 1
  const id = randomUUID()

  if (body?.dry_run === true) {
    return { dry_run: true, changes: { id, title, description, content, folder_id: folderId, tags, login_required: loginRequired } }
  }

  const now = Date.now()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO prompts (id, user_id, title, description, content, folder_id, login_required, version_count, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, '1.0.0', ?, ?)`
    ).run(id, userId, title, description, content, folderId, loginRequired, now, now)

    db.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, content, version_number, variables, change_note, created_at)
       VALUES (?, ?, ?, '1.0.0', '', '', ?)`
    ).run(randomUUID(), id, content, now)

    const insTag = db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)')
    for (const tagId of tags) insTag.run(id, tagId, now)
  })()

  return { prompt: getPromptDetail(db, userId, id) }
}

/** 取提示词详情（含标签），强制归属校验 */
export function getPromptDetail(db: DB, userId: number, id: string) {
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!prompt) fail(404, '提示词不存在')
  prompt.tags = db.prepare(
    'SELECT t.id, t.name, t.color FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = ?'
  ).all(id)
  return prompt
}

export function updatePrompt(db: DB, userId: number, rawId: unknown, body: any) {
  const id = String(rawId)
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(id, userId) as any
  // AI 只允许操作自己的提示词；管理员的公共提示词不开放 AI 编辑（避免绕过审核流程）
  if (!prompt) fail(404, '提示词不存在')

  // 还原（从回收站恢复）
  if (body?.restore === true || body?.deleted_at === null) {
    if (body?.dry_run === true) return { dry_run: true, target_id: id, changes: { restore: true } }
    db.prepare('UPDATE prompts SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?').run(Date.now(), id, userId)
    return { prompt: getPromptDetail(db, userId, id), restored: true }
  }

  const patch: Record<string, any> = {}
  if (body?.title !== undefined) {
    const title = String(body.title).trim()
    if (!title) fail(400, '标题不能为空')
    if (title.length > 256) fail(400, '标题最长 256 字符')
    patch.title = title
  }
  if (body?.description !== undefined) {
    const description = String(body.description)
    if (description.length > 2000) fail(400, '描述最长 2000 字符')
    patch.description = description
  }
  if (body?.content !== undefined) {
    const content = String(body.content)
    if (!content) fail(400, '内容不能为空')
    if (content.length > 100000) fail(400, '内容最长 100000 字符')
    patch.content = content
  }
  if (body?.folder_id !== undefined) {
    const fid = body.folder_id == null || body.folder_id === '' ? null : String(body.folder_id)
    if (fid) {
      const folder = db.prepare('SELECT user_id FROM prompt_folders WHERE id = ?').get(fid) as { user_id: number } | undefined
      if (!folder) fail(400, '目标提示词文件夹不存在')
      if (folder.user_id !== userId) fail(403, '无权写入此文件夹')
    }
    patch.folder_id = fid
  }
  if (body?.is_favorite !== undefined) patch.is_favorite = body.is_favorite ? 1 : 0
  if (body?.login_required !== undefined) patch.login_required = body.login_required ? 1 : 0

  const tags = Array.isArray(body?.tags) ? body.tags.map(String) : undefined
  const contentChanged = patch.content !== undefined && patch.content !== prompt.content

  if (Object.keys(patch).length === 0 && tags === undefined) fail(400, '没有提供任何可更新字段')

  const versionBump = contentChanged
    ? { version_count: (prompt.version_count || 0) + 1, current_version: `${(prompt.version_count || 0) + 1}.0` }
    : {}

  if (body?.dry_run === true) {
    return { dry_run: true, target_id: id, changes: { ...patch, ...versionBump, ...(tags ? { tags } : {}) } }
  }

  const now = Date.now()
  db.transaction(() => {
    const sets = [...Object.keys(patch), ...Object.keys(versionBump)]
    const values = [...Object.values(patch), ...Object.values(versionBump)]
    if (sets.length > 0) {
      db.prepare(`UPDATE prompts SET ${sets.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(...values, now, id, userId)
    }
    if (contentChanged) {
      db.prepare(
        `INSERT INTO prompt_versions (id, prompt_id, content, version_number, variables, change_note, created_at)
         VALUES (?, ?, ?, ?, '', ?, ?)`
      ).run(randomUUID(), id, patch.content, versionBump.current_version, String(body?.change_note ?? ''), now)
    }
    if (tags !== undefined) {
      db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?').run(id)
      const insTag = db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)')
      for (const tagId of tags) insTag.run(id, tagId, now)
    }
  })()

  return { prompt: getPromptDetail(db, userId, id) }
}

/** 软删除（移入回收站，可恢复）；`permanent: true` 才物理删除 */
export function deletePrompt(db: DB, userId: number, rawId: unknown, body: any) {
  if (body?.confirm !== true) fail(400, '删除操作必须携带 confirm:true')
  const id = String(rawId)
  const prompt = db.prepare('SELECT id, title FROM prompts WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!prompt) fail(404, '提示词不存在')

  const permanent = body?.permanent === true
  if (body?.dry_run === true) return { dry_run: true, changes: { delete: { id, title: prompt.title }, permanent } }

  if (permanent) {
    db.prepare('DELETE FROM prompts WHERE id = ? AND user_id = ?').run(id, userId)
  } else {
    db.prepare('UPDATE prompts SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(Date.now(), Date.now(), id, userId)
  }
  return { success: true, deleted: { id, title: prompt.title }, permanent, recoverable: !permanent }
}

// ════════════════════════════════════════════════════════════════
// 标签 tags
// ════════════════════════════════════════════════════════════════

export function listTags(db: DB, userId: number) {
  const tags = db.prepare(
    `SELECT t.id, t.name, t.color, t.created_at,
            (SELECT COUNT(*) FROM prompt_tags pt WHERE pt.tag_id = t.id) AS prompt_count
       FROM tags t WHERE t.user_id = ? ORDER BY t.created_at DESC`
  ).all(userId)
  return { tags, count: tags.length }
}

export function createTag(db: DB, userId: number, body: any) {
  const name = String(body?.name ?? '').trim()
  if (!name) fail(400, '标签名称不能为空')
  if (name.length > 64) fail(400, '标签名称最长 64 字符')

  const existing = db.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ?').get(userId, name) as any
  if (existing) return { tag: existing, existed: true }

  if (body?.dry_run === true) return { dry_run: true, changes: { name } }

  const id = randomUUID()
  const now = Date.now()
  const color = body?.color != null ? String(body.color) : ''
  db.prepare('INSERT INTO tags (id, user_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, color, now, now)

  return { tag: db.prepare('SELECT * FROM tags WHERE id = ?').get(id) }
}

/** 删除标签 —— 与 Web 端点语义一致：仅管理员可删除 */
export function deleteTag(db: DB, userId: number, rawId: unknown, body: any) {
  if (body?.confirm !== true) fail(400, '删除操作必须携带 confirm:true')
  if (!isUserAdmin(db, userId)) fail(403, '仅管理员可删除标签')

  const id = String(rawId)
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as any
  if (!tag) fail(404, '标签不存在')

  if (body?.dry_run === true) return { dry_run: true, changes: { delete: { id, name: tag.name } } }

  db.transaction(() => {
    db.prepare('DELETE FROM prompt_tags WHERE tag_id = ?').run(id)
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)
  })()
  return { success: true, deleted: { id, name: tag.name } }
}

// ════════════════════════════════════════════════════════════════
// Token 白嫖通告 token_deals
// ════════════════════════════════════════════════════════════════

/** 列表：公开的 approved 通告 + 自己发布的全部（含 pending / rejected） */
export function listTokenDeals(db: DB, userId: number, query: any) {
  const { limit, page, offset } = paging(query, 50)
  const where: string[] = [`(td.status = 'approved' OR td.user_id = ?)`]
  const params: any[] = [userId]

  if (query?.mine === 'true' || query?.mine === true) where.push('td.user_id = ?'), params.push(userId)
  if (query?.region) { where.push('td.region = ?'); params.push(String(query.region)) }
  if (query?.quality) { where.push('td.quality = ?'); params.push(String(query.quality)) }
  if (query?.q) {
    const kw = escapeLike(String(query.q).trim())
    where.push(`(td.provider LIKE ? ESCAPE '\\' OR td.title LIKE ? ESCAPE '\\')`)
    params.push(`%${kw}%`, `%${kw}%`)
  }

  const whereSql = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM token_deals td WHERE ${whereSql}`).get(...params) as { c: number }).c
  const deals = db.prepare(
    `SELECT td.* FROM token_deals td WHERE ${whereSql}
      ORDER BY td.pinned DESC, td.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[]

  for (const d of deals) {
    try { d.models = JSON.parse(d.models || '[]') } catch { d.models = [] }
  }

  return { token_deals: deals, pagination: { page, limit, total } }
}

export function createTokenDeal(db: DB, userId: number, body: any) {
  const result = validateDealPayload(body)
  if (!result.ok) fail(400, result.error)
  const d = result.data

  const isAdmin = isUserAdmin(db, userId)
  const status = isAdmin ? 'approved' : 'pending'
  const id = newDealId()

  if (body?.dry_run === true) {
    return { dry_run: true, changes: { ...d, status } }
  }

  const now = Date.now()
  db.prepare(`
    INSERT INTO token_deals (
      id, user_id, provider, title, url, call_url, quota, models, region, quality,
      source_tag, expires_at, pinned, note, status, reject_reason,
      vote_up, vote_down, rating_sum, rating_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '', 0, 0, 0, 0, ?, ?)
  `).run(
    id, userId, d.provider, d.title, d.url, d.callUrl, d.quota,
    JSON.stringify(d.models), d.region, d.quality, d.sourceTag,
    d.expiresAt, d.note, status, now, now,
  )

  return {
    token_deal: db.prepare('SELECT * FROM token_deals WHERE id = ?').get(id),
    status,
    message: isAdmin ? '已发布（管理员直接上线）' : '已提交，等待管理员审核',
  }
}

export function deleteTokenDeal(db: DB, userId: number, rawId: unknown, body: any) {
  if (body?.confirm !== true) fail(400, '删除操作必须携带 confirm:true')
  const id = String(rawId)
  const deal = db.prepare('SELECT id, user_id, title FROM token_deals WHERE id = ?').get(id) as any
  if (!deal) fail(404, '通告不存在')
  if (deal.user_id !== userId && !isUserAdmin(db, userId)) fail(403, '无权删除此通告')

  if (body?.dry_run === true) return { dry_run: true, changes: { delete: { id, title: deal.title } } }

  db.transaction(() => {
    db.prepare('DELETE FROM token_deal_votes WHERE deal_id = ?').run(id)
    db.prepare('DELETE FROM token_deal_reviews WHERE deal_id = ?').run(id)
    db.prepare('DELETE FROM token_deals WHERE id = ?').run(id)
  })()

  return { success: true, deleted: { id, title: deal.title } }
}
