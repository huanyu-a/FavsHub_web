/**
 * GET /api/prompts/folders/all — 获取提示词文件夹列表（含 prompt_count）
 * 游客：管理员的公开文件夹（含继承过滤）
 * 管理员：全部
 * 普通登录用户：自己的 + 管理员的公开文件夹
 *
 * login_required 继承规则：子文件夹继承父文件夹的 login_required
 */
import { getRawDb } from '../../../database'
import { optionalAuth } from '../../../utils/auth'

/** 根据继承规则过滤文件夹（子文件夹继承父文件夹的 login_required） */
function filterByInheritance(folders: any[]): any[] {
  function isLocked(f: any, visited = new Set<string>()): boolean {
    if (f.login_required) return true
    if (f.parent_id == null) return false
    if (visited.has(f.parent_id)) return false
    visited.add(f.parent_id)
    const parent = folders.find(p => p.id === f.parent_id)
    if (!parent) return false
    return isLocked(parent, visited)
  }
  return folders.filter(f => !isLocked(f))
}

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  let folders: any[]

  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser?.is_admin) {
      // 管理员看全部
      folders = db.prepare(`
        SELECT pf.*, COUNT(p.id) as prompt_count
        FROM prompt_folders pf
        LEFT JOIN prompts p ON p.folder_id = pf.id
        GROUP BY pf.id
        ORDER BY pf.parent_id NULLS FIRST, pf.sort_order
      `).all()
    } else {
      // 登录用户：自己的全部 + 管理员的（继承过滤）
      const allAdminFolders = db.prepare(`
        SELECT pf.*, COUNT(p.id) as prompt_count
        FROM prompt_folders pf
        LEFT JOIN prompts p ON p.folder_id = pf.id
          AND (p.user_id = ? OR (p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)))
        WHERE pf.user_id IN (SELECT id FROM users WHERE is_admin = 1)
        GROUP BY pf.id
        ORDER BY pf.parent_id NULLS FIRST, pf.sort_order
      `).all(user.id) as any[]
      const myFolders = db.prepare(`
        SELECT pf.*, COUNT(p.id) as prompt_count
        FROM prompt_folders pf
        LEFT JOIN prompts p ON p.folder_id = pf.id AND p.user_id = ?
        WHERE pf.user_id = ?
        GROUP BY pf.id
        ORDER BY pf.parent_id NULLS FIRST, pf.sort_order
      `).all(user.id, user.id) as any[]
      const visibleAdminFolders = filterByInheritance(allAdminFolders)
      const myIds = new Set(myFolders.map(f => f.id))
      const merged = [...myFolders, ...visibleAdminFolders.filter(f => !myIds.has(f.id))]
      folders = merged.sort((a: any, b: any) => {
        const ap = a.parent_id ?? '', bp = b.parent_id ?? ''
        if (ap !== bp) return ap < bp ? -1 : 1
        return (a.sort_order || 0) - (b.sort_order || 0)
      })
    }
  } else {
    // 游客：只看管理员的公开文件夹（继承过滤）
    const allAdminFolders = db.prepare(`
      SELECT pf.*, COUNT(p.id) as prompt_count
      FROM prompt_folders pf
      LEFT JOIN prompts p ON p.folder_id = pf.id AND p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)
      WHERE pf.user_id IN (SELECT id FROM users WHERE is_admin = 1)
      GROUP BY pf.id
      ORDER BY pf.parent_id NULLS FIRST, pf.sort_order
    `).all() as any[]
    folders = filterByInheritance(allAdminFolders)
  }

  // 添加兼容字段
  for (const f of folders) {
    ;(f as any).folder_id = f.id
    ;(f as any).folder_name = f.name
  }

  return { folders }
})
