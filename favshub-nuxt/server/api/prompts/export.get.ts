/**
 * GET /api/prompts/export — 导出提示词（兼容 promptpro v2.0.0 JSON）
 * 管理员传 ?all=1 可导出全部用户提示词（此时每条 prompt 带 username）
 *
 * 输出结构与 promptpro-backup-*.json 同源，可无缝导入旧的 promptpro 系统，
 * 亦可被 FavsHub 自身的 /api/prompts/import 重新读回。
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()
  const query = getQuery(event)

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin
  const exportAll = isAdmin && query.all === '1'

  // ── 文件夹 ──────────────────────────────────────
  const folders = exportAll
    ? db.prepare(`SELECT * FROM prompt_folders ORDER BY created_at ASC`).all() as any[]
    : db.prepare(`SELECT * FROM prompt_folders WHERE user_id = ? ORDER BY created_at ASC`).all(user.id) as any[]

  // ── 提示词 ──────────────────────────────────────
  const prompts = exportAll
    ? db.prepare(`
        SELECT p.*, u.username
        FROM prompts p
        LEFT JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at ASC
      `).all() as any[]
    : db.prepare(`
        SELECT * FROM prompts WHERE user_id = ? ORDER BY created_at ASC
      `).all(user.id) as any[]

  const promptIds = prompts.map(p => p.id)
  const placeholders = promptIds.map(() => '?').join(',')

  // ── 所有标签 & 关联 ──────────────────────────────
  const allTags = promptIds.length > 0
    ? db.prepare(`
        SELECT DISTINCT t.* FROM tags t
        JOIN prompt_tags pt ON t.id = pt.tag_id
        WHERE pt.prompt_id IN (${placeholders})
        ORDER BY t.created_at ASC
      `).all(...promptIds) as any[]
    : []

  const tagRelations = promptIds.length > 0
    ? db.prepare(`
        SELECT * FROM prompt_tags
        WHERE prompt_id IN (${placeholders})
        ORDER BY created_at ASC
      `).all(...promptIds) as any[]
    : []

  // ── 版本历史 ──────────────────────────────────────
  const versions = promptIds.length > 0
    ? db.prepare(`
        SELECT * FROM prompt_versions
        WHERE prompt_id IN (${placeholders})
        ORDER BY created_at ASC
      `).all(...promptIds) as any[]
    : []

  // ── 时间格式化：promptpro 用 "YYYY-MM-DD HH:mm:ss"（本地时间）──
  function fmt(ts: number | null): string | null {
    if (!ts) return null
    const d = new Date(ts)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  // ── 组装 promptpro v2.0.0 结构 ──────────────────────
  const exportData = {
    version: '2.0.0',
    export_date: new Date().toISOString(),
    ...(exportAll ? {} : { user_id: user.id }),
    prompts: prompts.map(p => ({
      prompt_id: p.id,
      title: p.title,
      description: p.description || '',
      content: p.content,
      avatar: p.avatar || null,
      is_favorite: p.is_favorite ?? 0,
      version_count: p.version_count ?? 0,
      current_version: p.current_version || '1.0.0',
      created_at: p.created_at,
      updated_at: p.updated_at,
      folder_id: p.folder_id || null,
      backup_id: 1,
      created_time: fmt(p.created_at),
      updated_time: fmt(p.updated_at),
      ...(exportAll ? { username: p.username || '' } : {}),
    })),
    folders: folders.map(f => ({
      folder_id: f.id,
      folder_name: f.name,
      created_at: f.created_at,
      updated_at: f.updated_at,
      backup_id: 1,
      created_time: fmt(f.created_at),
      updated_time: fmt(f.updated_at),
    })),
    tags: allTags.map((t, i) => ({
      tag_id: t.id,
      tag_name: t.name,
      color: t.color || '#F53F3F',
      created_at: t.created_at,
      updated_at: t.updated_at,
      backup_id: 1,
      created_time: fmt(t.created_at),
      updated_time: fmt(t.updated_at),
    })),
    tag_relations: tagRelations.map((r, i) => ({
      relation_id: i + 1,
      prompt_id: r.prompt_id,
      tag_id: r.tag_id,
      created_at: r.created_at,
      id: r.id,
    })),
    versions: versions.map(v => ({
      version_id: v.id,
      prompt_id: v.prompt_id,
      content: v.content,
      variables: v.variables || '[]',
      version_number: v.version_number || '1.0.0',
      created_at: v.created_at,
      backup_id: 1,
      created_time: fmt(v.created_at),
    })),
  }

  const json = JSON.stringify(exportData, null, 2)

  setResponseHeaders(event, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="promptpro-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json"`,
  })

  return json
})
