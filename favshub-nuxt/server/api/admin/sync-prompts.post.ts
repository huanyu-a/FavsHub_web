/**
 * POST /api/admin/sync-prompts — 浏览器 IndexedDB 提示词同步到服务端
 */
import { getRawDb } from '../../database'
import { requireAdmin } from '../../utils/auth'
import { createError, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  const body = await readBody(event)
  const { userId, prompts, folders, tags, tagRelations, versions } = body

  if (!userId) {
    throw createError({ statusCode: 400, data: { error: '缺少 userId' } })
  }
  if (!Array.isArray(prompts)) {
    throw createError({ statusCode: 400, data: { error: 'prompts 必须是数组' } })
  }

  const now = Date.now()
  let importedCount = 0

  const tx = db.transaction(() => {
    // 0. 先清空该用户的提示词相关数据
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId)
    db.prepare('DELETE FROM prompt_versions WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId)
    db.prepare('DELETE FROM prompts WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM prompt_folders WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM tags WHERE user_id = ?').run(userId)

    // 1. 先插入文件夹
    if (Array.isArray(folders)) {
      const insertFolder = db.prepare('INSERT OR REPLACE INTO prompt_folders (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      for (const f of folders) {
        insertFolder.run(f.folder_id || f.id, userId, f.folder_name || f.name || '', f.created_at || now, f.updated_at || now)
      }
    }

    // 2. 插入标签
    if (Array.isArray(tags)) {
      const insertTag = db.prepare('INSERT OR REPLACE INTO tags (id, user_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (const t of tags) {
        insertTag.run(t.tag_id || t.id, userId, t.tag_name || t.name || '', t.color || '', t.created_at || now, t.updated_at || now)
      }
    }

    // 3. 插入提示词
    const insertPrompt = db.prepare('INSERT OR REPLACE INTO prompts (id, user_id, title, description, content, folder_id, is_favorite, version_count, current_version, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const p of prompts) {
      insertPrompt.run(
        p.prompt_id, userId, p.title || '', p.description || '', p.content || '',
        p.folder_id || null, p.is_favorite ? 1 : 0, p.version_count || 1,
        p.current_version || '1.0.0', p.avatar || '', p.created_at || now, p.updated_at || now
      )
      importedCount++
    }

    // 4. 插入标签关联
    if (Array.isArray(tagRelations)) {
      const promptIds = prompts.map((p: any) => p.prompt_id)
      if (promptIds.length > 0) {
        const placeholders = promptIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM prompt_tags WHERE prompt_id IN (${placeholders})`).run(...promptIds)
      }
      const insertRelation = db.prepare('INSERT INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)')
      for (const tr of tagRelations) {
        insertRelation.run(tr.prompt_id, tr.tag_id, tr.created_at || now)
      }
    }

    // 5. 插入版本历史
    if (Array.isArray(versions)) {
      const insertVersion = db.prepare('INSERT OR REPLACE INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (const v of versions) {
        insertVersion.run(v.version_id, v.prompt_id, v.content || '', v.version_number || '1.0.0', v.variables || '', v.created_at || now)
      }
    }
  })

  try {
    db.pragma('foreign_keys = OFF')
    tx()
    return { success: true, message: `已导入 ${importedCount} 条提示词`, count: importedCount }
  } catch (err: any) {
    console.error('[Admin] 提示词导入失败:', err.message)
    throw createError({ statusCode: 500, data: { error: '导入失败，请检查数据格式是否正确' } })
  } finally {
    db.pragma('foreign_keys = ON')
  }
})
