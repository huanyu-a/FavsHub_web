/**
 * POST /api/prompts/import — 导入提示词（兼容 promptpro v2.0.0 / v1.0 JSON）
 *
 * 支持三种格式自动识别：
 *   - promptpro v2.0.0：{ version, prompts[], folders[], tags[], tag_relations[], versions[] }
 *   - promptpro v1.0  ：{ version: "1.0", data: { prompts, folders, tags, tag_relations, versions } }
 *   - FavsHub 旧格式 ：{ exported_at, folders, prompts }（向后兼容）
 *
 * 字段映射：
 *   prompt_id → id，folder_name → name，folder_id → folder_id，
 *   tag_id → id（tags），relation → prompt_tags，versions → prompt_versions
 *   时间：优先用 created_at（epoch ms），缺则解析 created_time 字符串为本地时间
 */
import { randomUUID } from 'node:crypto'
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { readMultipartFormData, createError } from 'h3'

// ── 时间解析：兼容 epoch ms 和 "YYYY-MM-DD HH:mm:ss" 字符串 ──
function parseTime(v: unknown, fallback: number): number {
  if (typeof v === 'number' && v > 0) return v
  if (typeof v === 'string' && v) {
    // "YYYY-MM-DD HH:mm:ss" → local time → epoch ms
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/)
    if (m) {
      const [, y, mo, d, h, mi, s] = m
      const ts = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime()
      if (!isNaN(ts)) return ts
    }
    const parsed = Date.parse(v)
    if (!isNaN(parsed)) return parsed
  }
  return fallback
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  // ── 读取 multipart 文件 ─────────────────────────
  const parts = await readMultipartFormData(event)
  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, data: { error: '请上传 JSON 文件（字段名 file）' } })
  }

  const filePart = parts.find(p => p.name === 'file') || parts[0]
  if (!filePart.data) {
    throw createError({ statusCode: 400, data: { error: '文件内容为空' } })
  }

  let raw: Record<string, any>
  try {
    raw = JSON.parse(filePart.data.toString('utf-8'))
  } catch {
    throw createError({ statusCode: 400, data: { error: 'JSON 解析失败，请检查文件' } })
  }

  // ── 格式归一化到 v2.0.0 ──────────────────────────
  let prompts: any[] = []
  let folders: any[] = []
  let tags: any[] = []
  let tagRelations: any[] = []
  let versions: any[] = []

  if (raw.version === '1.0' && raw.data) {
    // promptpro v1.0
    prompts = raw.data.prompts || []
    folders = raw.data.folders || []
    tags = raw.data.tags || []
    tagRelations = raw.data.tag_relations || []
    versions = raw.data.versions || []
  } else if (Array.isArray(raw.prompts) && (raw.version === '2.0.0' || raw.version === '2.0')) {
    // promptpro v2.0.0
    prompts = raw.prompts
    folders = raw.folders || []
    tags = raw.tags || []
    tagRelations = raw.tag_relations || []
    versions = raw.versions || []
  } else if (Array.isArray(raw.prompts)) {
    // FavsHub 旧格式（无 version 字段或未知）
    prompts = raw.prompts
    folders = (raw.folders || []).map((f: any) => ({
      folder_id: f.id || f.folder_id || randomUUID(),
      folder_name: f.name || f.folder_name,
      created_at: f.created_at, updated_at: f.updated_at,
      created_time: f.created_time, updated_time: f.updated_time,
    }))
    // 旧格式：tags 嵌在 prompt.tags=[{id,name,color}] 里，也可能顶层有 tags 数组
    const tagMap = new Map<string, any>()
    if (Array.isArray(raw.tags)) {
      for (const t of raw.tags) tagMap.set(t.id || t.tag_id, t)
    }
    for (const p of prompts) {
      if (Array.isArray(p.tags)) {
        for (const t of p.tags) {
          const tid = t.id || t.tag_id
          if (tid && !tagMap.has(tid)) tagMap.set(tid, t)
        }
      }
    }
    tags = Array.from(tagMap.values()).map((t: any) => ({
      tag_id: t.id || t.tag_id || randomUUID(),
      tag_name: t.name || t.tag_name,
      color: t.color || '#F53F3F',
      created_at: t.created_at, updated_at: t.updated_at,
    }))
    // 重建 tag_relations（按 prompt.tags [{id}] 数组）
    tagRelations = []
    for (const p of prompts) {
      if (Array.isArray(p.tags)) {
        for (const t of p.tags) {
          tagRelations.push({ prompt_id: p.id || p.prompt_id, tag_id: t.id || t.tag_id })
        }
      }
    }
  } else {
    throw createError({ statusCode: 400, data: { error: '未识别的 JSON 结构，需包含 prompts 数组' } })
  }

  if (prompts.length === 0) {
    throw createError({ statusCode: 400, data: { error: '备份中无提示词数据' } })
  }

  const now = Date.now()

  // ── 导入策略：基于 id 的去重插入 ────────────────────────
  // 使用 better-sqlite3 的 transaction() 确保原子性
  let importedFolders = 0
  let importedPrompts = 0
  let importedTags = 0
  let importedVersions = 0
  let importedRelations = 0
  let skippedPrompts = 0

  try {
    const insFolder = db.prepare(`
      INSERT OR IGNORE INTO prompt_folders (id, user_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insPrompt = db.prepare(`
      INSERT OR IGNORE INTO prompts (id, user_id, title, description, content, folder_id, is_favorite, avatar, login_required, version_count, current_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insTag = db.prepare(`
      INSERT OR IGNORE INTO tags (id, user_id, name, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insRelation = db.prepare(`
      INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)
    `)
    const insVersion = db.prepare(`
      INSERT OR IGNORE INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    // 用 better-sqlite3 事务包裹全部写操作
    const tx = db.transaction(() => {
      // 文件夹
      for (const f of folders) {
        const id = f.folder_id || f.id || randomUUID()
        const name = f.folder_name || f.name
        if (!name) continue
        const res = insFolder.run(id, user.id, name, parseTime(f.created_at || f.created_time, now), parseTime(f.updated_at || f.updated_time, now))
        if (res.changes) importedFolders++
      }

      // 标签（先于关联）
      const tagIdMap = new Map<string, string>()  // 旧 tag_id → 新 id（本场景为 1:1）
      for (const t of tags) {
        const id = t.tag_id || t.id || randomUUID()
        tagIdMap.set(t.tag_id || t.id, id)
        const res = insTag.run(id, user.id, t.tag_name || t.name || '', t.color || '#F53F3F', parseTime(t.created_at || t.created_time, now), parseTime(t.updated_at || t.updated_time, now))
        if (res.changes) importedTags++
      }

      // 提示词
      const promptIdMap = new Map<string, string>()  // 旧 prompt_id → 新 id（本场景 1:1）
      for (const p of prompts) {
        const id = p.prompt_id || p.id || randomUUID()
        promptIdMap.set(p.prompt_id || p.id, id)

        // 文件夹引用不存在 → 置空
        let folderId = p.folder_id || p.folderId || null
        if (folderId) {
          const exists = folders.some(f => (f.folder_id || f.id) === folderId)
          if (!exists) folderId = null
        }

        const res = insPrompt.run(
          id,
          user.id,
          p.title || '未命名提示词',
          p.description || '',
          p.content || '',
          folderId,
          p.is_favorite ?? 0,
          p.avatar || null,
          1,  // 导入后默认私有
          p.version_count ?? 0,
          p.current_version || '1.0.0',
          parseTime(p.created_at || p.created_time, now),
          parseTime(p.updated_at || p.updated_time, now),
        )
        if (res.changes) importedPrompts++
        else skippedPrompts++
      }

      // 版本历史
      for (const v of versions) {
        const oldPid = v.prompt_id
        if (!promptIdMap.has(oldPid)) continue  // 不属于本次导入的提示词 → 跳过
        const newPid = promptIdMap.get(oldPid)!
        const verId = v.version_id || v.id || randomUUID()
        const res = insVersion.run(verId, newPid, v.content || '', v.version_number || '1.0.0', v.variables || '[]', parseTime(v.created_at || v.created_time, now))
        if (res.changes) importedVersions++
      }

      // 标签关联（内存去重，因为 prompt_tags 无 UNIQUE(prompt_id, tag_id) 约束）
      const seenRelations = new Set<string>()
      const promptIds = Array.from(promptIdMap.values())
      if (promptIds.length > 0) {
        const placeholders = promptIds.map(() => '?').join(',')
        const existingRels = db.prepare(`SELECT prompt_id, tag_id FROM prompt_tags WHERE prompt_id IN (${placeholders})`).all(...promptIds) as any[]
        for (const er of existingRels) seenRelations.add(`${er.prompt_id}::${er.tag_id}`)
      }

      for (const r of tagRelations) {
        const oldPid = r.prompt_id
        const newPid = promptIdMap.get(oldPid)
        if (!newPid) continue  // 关联到本次未导入的提示词 → 跳过
        let newTid = tagIdMap.get(r.tag_id) || r.tag_id
        // 若旧 tag_id 未在映射中，检查是否刚好已存在同名 tag
        if (tagIdMap.size > 0 && !tagIdMap.has(r.tag_id)) {
          const tRow = db.prepare('SELECT id FROM tags WHERE user_id = ? AND id = ?').get(user.id, r.tag_id) as any
          if (!tRow) continue  // 引用了不存在之 tag
        }
        const relKey = `${newPid}::${newTid}`
        if (seenRelations.has(relKey)) continue
        seenRelations.add(relKey)
        const res = insRelation.run(newPid, newTid, parseTime(r.created_at || now, now))
        if (res.changes) importedRelations++
      }
    })

    // 执行事务（失败自动回滚）
    tx()

  } catch (err: any) {
    console.error('[Import] 提示词导入失败:', err.message, err.stack)
    throw createError({ statusCode: 500, data: { error: '导入失败: ' + (err?.message || '未知错误') } })
  }

  return {
    success: true,
    imported: {
      folders: importedFolders,
      prompts: importedPrompts,
      tags: importedTags,
      versions: importedVersions,
      tag_relations: importedRelations,
    },
    skipped_prompts: skippedPrompts,
  }
})
