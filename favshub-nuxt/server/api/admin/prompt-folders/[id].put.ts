/**
 * PUT /api/admin/prompt-folders/:id — 更新提示词文件夹
 * 管理员：可更新任意文件夹
 * 普通用户：仅可更新自己的文件夹，且不能更改 login_required
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '无效的文件夹 ID' } })
  }

  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  if (!isAdmin && folder.user_id !== auth.id) {
    throw createError({ statusCode: 403, data: { error: '无权限修改此文件夹' } })
  }

  const body = await readBody(event)
  const { name, parent_id, icon, sort_order, login_required } = body

  if (name !== undefined) {
    db.prepare('UPDATE prompt_folders SET name = ? WHERE id = ?').run(name, id)
  }
  if (icon !== undefined) {
    db.prepare('UPDATE prompt_folders SET icon = ? WHERE id = ?').run(icon, id)
  }
  if (parent_id !== undefined) {
    if (parent_id === id) {
      throw createError({ statusCode: 400, data: { error: '不能将文件夹设为自己的子文件夹' } })
    }
    // 检查循环引用
    if (parent_id !== null && parent_id !== '') {
      let currentParent: string | null = parent_id
      const visited = new Set<string>([id])
      while (currentParent !== null && currentParent !== '') {
        if (visited.has(currentParent)) {
          throw createError({ statusCode: 400, data: { error: '不能将文件夹移动到其子文件夹下（循环引用）' } })
        }
        visited.add(currentParent)
        const parentRow = db.prepare('SELECT parent_id FROM prompt_folders WHERE id = ?').get(currentParent) as { parent_id: string | null } | undefined
        if (!parentRow) break
        currentParent = parentRow.parent_id
      }
    }
    // 普通用户只能移动到自己拥有的文件夹下
    if (!isAdmin && parent_id !== null && parent_id !== '') {
      const parent = db.prepare('SELECT id FROM prompt_folders WHERE id = ? AND user_id = ?').get(parent_id, auth.id) as any
      if (!parent) {
        throw createError({ statusCode: 403, data: { error: '无权限移动到目标文件夹' } })
      }
    }
    db.prepare('UPDATE prompt_folders SET parent_id = ? WHERE id = ?').run(parent_id || null, id)
  }
  if (sort_order !== undefined) {
    db.prepare('UPDATE prompt_folders SET sort_order = ? WHERE id = ?').run(sort_order, id)
  }
  if (isAdmin && login_required !== undefined) {
    db.prepare('UPDATE prompt_folders SET login_required = ? WHERE id = ?').run(login_required ? 1 : 0, id)
  }

  db.prepare('UPDATE prompt_folders SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  const updated = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id)
  return { folder: updated }
})
