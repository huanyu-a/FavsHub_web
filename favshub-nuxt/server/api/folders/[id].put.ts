/**
 * PUT /api/folders/:id — 更新文件夹
 * 仅文件夹所有者或管理员可操作
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const params = getRouterParams(event)
  const body = await readBody(event)
  const { name, sort_order, login_required, icon, parent_id } = body || {}

  if (name !== undefined && name.length > 128) {
    throw createError({ statusCode: 400, data: { error: '文件夹名称最长 128 字符' } })
  }

  const db = getRawDb()

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(params.id) as any
  if (!folder) {
    throw createError({ statusCode: 404, data: { error: '文件夹不存在' } })
  }

  // 所有权检查：仅文件夹所有者或管理员可修改
  if (folder.user_id !== user.id) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (!dbUser?.is_admin) {
      throw createError({ statusCode: 403, data: { error: '无权修改此文件夹' } })
    }
  }

  const tx = db.transaction(() => {
    if (name !== undefined) {
      db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folder.id)
    }
    if (sort_order !== undefined) {
      db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?').run(sort_order, folder.id)
    }
    if (login_required !== undefined) {
      db.prepare('UPDATE folders SET login_required = ? WHERE id = ?').run(login_required ? 1 : 0, folder.id)
    }
    if (icon !== undefined) {
      db.prepare('UPDATE folders SET icon = ? WHERE id = ?').run(icon, folder.id)
    }
    if (parent_id !== undefined) {
      // 检查循环引用：遍历 parent_id 链，确保不会形成环
      if (parent_id !== null && parent_id !== folder.id) {
        let currentParent: number | null = parent_id
        const visited = new Set<number>([folder.id])
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
      db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parent_id, folder.id)
    }
  })
  tx()

  const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(folder.id)
  return { folder: updated }
})
