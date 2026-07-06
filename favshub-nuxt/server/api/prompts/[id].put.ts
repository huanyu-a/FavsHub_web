/**
 * PUT /api/prompts/:id — 更新提示词
 * Body: { title, description, content, folder_id, tags, is_favorite, login_required }
 * 内容变更时自动创建新版本
 */
import { randomUUID } from 'node:crypto'
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const db = getRawDb()

  // 验证归属
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }
  if (prompt.user_id !== user.id) {
    // 检查是否是管理员的提示词 → 非管理员编辑需走审核流程
    const ownerIsAdmin = (db.prepare('SELECT is_admin FROM users WHERE id = ?').get(prompt.user_id) as any)?.is_admin
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as any
    if (ownerIsAdmin && !dbUser?.is_admin) {
      // 非管理员编辑管理员的提示词 → 创建审核请求
      const { title, description, content, tags } = body || {}
      if (!title && !description && !content && !tags) {
        throw createError({ statusCode: 400, data: { error: '没有提供修改内容' } })
      }
      const now = Date.now()
      const reviewId = `${now}_review_${user.id}_${id.slice(0, 8)}`
      db.prepare(`
        INSERT INTO prompt_review_requests (id, prompt_id, user_id, title, description, content, tags, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(reviewId, id, user.id,
        title || prompt.title,
        description !== undefined ? (description || '') : prompt.description,
        content || prompt.content,
        JSON.stringify(tags || []),
        now
      )
      return { success: true, message: '已提交审核请求，等待管理员审核', review_id: reviewId, review_required: true }
    }
    throw createError({ statusCode: 403, data: { error: '无权修改此提示词' } })
  }

  const { title, description, content, folder_id, tags, is_favorite, login_required } = body || {}

  // 输入长度校验
  if (title !== undefined && title.length > 256) throw createError({ statusCode: 400, data: { error: '标题最长 256 字符' } })
  if (description !== undefined && description.length > 2000) throw createError({ statusCode: 400, data: { error: '描述最长 2000 字符' } })
  if (content !== undefined && content.length > 100000) throw createError({ statusCode: 400, data: { error: '内容最长 100000 字符' } })

  const now = Date.now()

  // 检测内容是否变更
  const contentChanged = content !== undefined && content !== prompt.content

  // 构建更新语句
  const updates: string[] = []
  const params: any[] = []

  if (title !== undefined) { updates.push('title = ?'); params.push(title) }
  if (description !== undefined) { updates.push('description = ?'); params.push(description) }
  if (content !== undefined) { updates.push('content = ?'); params.push(content) }
  if (folder_id !== undefined) { updates.push('folder_id = ?'); params.push(folder_id || null) }
  if (is_favorite !== undefined) { updates.push('is_favorite = ?'); params.push(is_favorite ? 1 : 0) }
  // 可见性：管理员可自由选择，普通用户强制私有（仅自己可见）
  if (login_required !== undefined) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    const lr = (dbUser?.is_admin) ? (login_required ? 1 : 0) : 1
    updates.push('login_required = ?'); params.push(lr)
  }

  // 内容变更时自增版本号
  if (contentChanged) {
    const versionNum = (prompt.version_count || 0) + 1
    updates.push('version_count = ?')
    params.push(versionNum)
    updates.push('current_version = ?')
    params.push(`${versionNum}.0`)

    // 创建新版本记录
    const versionId = randomUUID()
    db.prepare(`
      INSERT INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at)
      VALUES (?, ?, ?, ?, '', ?)
    `).run(versionId, id, content, `${versionNum}.0`, now)
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?')
    params.push(now)
    params.push(id)
    db.prepare(`UPDATE prompts SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  }

  // 更新标签关联
  if (Array.isArray(tags)) {
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?').run(id)
    const stmt = db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)')
    for (const tagId of tags) {
      stmt.run(id, tagId, now)
    }
  }

  // 返回更新后的 prompt
  const updated = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  const updatedTags = db.prepare(`
    SELECT t.id, t.name, t.color FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = ?
  `).all(id)
  updated.prompt_id = updated.id
  updated.tags = updatedTags

  return { prompt: updated }
})
