/**
 * GET /api/folders — 获取文件夹列表
 * 游客：管理员的公开文件夹（login_required = 0，含继承）
 * 管理员：全部
 * 普通登录用户：自己的 + 管理员的公开文件夹
 *
 * login_required 继承规则：子文件夹继承父文件夹的 login_required，
 * 即父文件夹上锁后，所有后代文件夹自动对非所有者不可见
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

/** 根据继承规则过滤文件夹 */
function filterByInheritance(folders: any[]): any[] {
  const parentMap = new Map<number | null, any[]>()
  for (const f of folders) {
    const pid = f.parent_id
    if (!parentMap.has(pid)) parentMap.set(pid, [])
    parentMap.get(pid)!.push(f)
  }

  // 递归检查：文件夹或其祖先是否被锁
  function isLocked(f: any, visited = new Set<number>()): boolean {
    if (f.login_required) return true
    if (f.parent_id == null) return false
    if (visited.has(f.parent_id)) return false // 防止循环引用
    visited.add(f.parent_id)
    // 找到父文件夹
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
      folders = db.prepare('SELECT * FROM folders ORDER BY parent_id NULLS FIRST, sort_order').all()
    } else {
      // 登录用户：自己的全部 + 管理员的文件夹（过滤继承锁）
      const allAdminFolders = db.prepare(
        `SELECT * FROM folders
         WHERE user_id IN (SELECT id FROM users WHERE is_admin = 1)
         ORDER BY parent_id NULLS FIRST, sort_order`
      ).all() as any[]
      const myFolders = db.prepare(
        'SELECT * FROM folders WHERE user_id = ? ORDER BY parent_id NULLS FIRST, sort_order'
      ).all(user.id) as any[]
      // 管理员的文件夹需要继承过滤
      const visibleAdminFolders = filterByInheritance(allAdminFolders)
      // 合并：自己的 + 可见的管理员文件夹（去重）
      const myIds = new Set(myFolders.map(f => f.id))
      const merged = [...myFolders, ...visibleAdminFolders.filter(f => !myIds.has(f.id))]
      folders = merged.sort((a: any, b: any) => {
        const ap = a.parent_id ?? 0, bp = b.parent_id ?? 0
        if (ap !== bp) return ap - bp
        return (a.sort_order || 0) - (b.sort_order || 0)
      })
    }
  } else {
    // 游客：只看管理员的公开文件夹（含继承过滤）
    const allAdminFolders = db.prepare(
      `SELECT * FROM folders
       WHERE user_id IN (SELECT id FROM users WHERE is_admin = 1)
       ORDER BY parent_id NULLS FIRST, sort_order`
    ).all() as any[]
    folders = filterByInheritance(allAdminFolders)
  }

  return { folders }
})
