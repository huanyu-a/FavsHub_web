/**
 * PUT /api/admin/folders/:id — 更新文件夹
 * 管理员：可更新任意文件夹
 * 普通用户：仅可更新自己的文件夹，且不能更改 login_required
 */
import { getRawDb } from '../../../database'
import { getAuthRole } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const authRole = getAuthRole(event)
  if (!authRole) throw createError({ statusCode: 401, data: { error: '未登录' } })
  const { user: auth, isAdmin } = authRole
  const db = getRawDb()

  const { id } = getRouterParams(event)
  const folderId = parseInt(id)
  if (isNaN(folderId)) {
    throw createError({ statusCode: 400, data: { error: '无效的文件夹 ID' } })
  }

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  if (!isAdmin && folder.user_id !== auth.id) {
    throw createError({ statusCode: 403, data: { error: '无权限修改此文件夹' } })
  }

  const body = await readBody(event)
  const { name, icon, parent_id, sort_order, login_required } = body

  if (name !== undefined) {
    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folderId)
  }
  if (icon !== undefined) {
    db.prepare('UPDATE folders SET icon = ? WHERE id = ?').run(icon, folderId)
  }
  if (parent_id !== undefined) {
    if (parent_id === folderId) {
      throw createError({ statusCode: 400, data: { error: '不能将文件夹设为自己的子文件夹' } })
    }
    // 检查循环引用
    if (parent_id !== null) {
      let currentParent: number | null = parent_id
      const visited = new Set<number>([folderId])
      while (currentParent !== null) {
        if (visited.has(currentParent)) {
          throw createError({ statusCode: 400, data: { error: '不能将文件夹移动到其子文件夹下（循环引用）' } })
        }
        visited.add(currentParent)
        const parentRow = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(currentParent) as { parent_id: number | null } | undefined
        if (!parentRow) break
        currentParent = parentRow.parent_id
      }
    }
    // 普通用户只能移动到自己拥有的文件夹下
    if (!isAdmin && parent_id !== null) {
      const parent = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(parent_id, auth.id) as any
      if (!parent) {
        throw createError({ statusCode: 403, data: { error: '无权限移动到目标文件夹' } })
      }
    }
    db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parent_id || null, folderId)
  }
  if (sort_order !== undefined) {
    db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?').run(sort_order, folderId)
  }
  if (isAdmin && login_required !== undefined) {
    db.prepare('UPDATE folders SET login_required = ? WHERE id = ?').run(login_required ? 1 : 0, folderId)
  }

  const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId)
  return { folder: updated }
})
