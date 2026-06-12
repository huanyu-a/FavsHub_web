/**
 * GET /api/prompts/folders/all — 获取提示词文件夹列表（含 prompt_count）
 * 游客：管理员的公开文件夹
 * 管理员：全部
 * 普通登录用户：自己的 + 管理员的
 */
import { getRawDb } from '../../../database'
import { optionalAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  let folders: any[]

  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser?.is_admin) {
      folders = db.prepare(`
        SELECT pf.*, COUNT(p.id) as prompt_count
        FROM prompt_folders pf
        LEFT JOIN prompts p ON p.folder_id = pf.id
        GROUP BY pf.id
        ORDER BY pf.created_at
      `).all()
    } else {
      folders = db.prepare(`
        SELECT pf.*, COUNT(p.id) as prompt_count
        FROM prompt_folders pf
        LEFT JOIN prompts p ON p.folder_id = pf.id
          AND (p.user_id = ? OR (p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)))
        WHERE pf.user_id = ? OR pf.user_id IN (SELECT id FROM users WHERE is_admin = 1)
        GROUP BY pf.id
        ORDER BY pf.created_at
      `).all(user.id, user.id)
    }
  } else {
    folders = db.prepare(`
      SELECT pf.*, COUNT(p.id) as prompt_count
      FROM prompt_folders pf
      LEFT JOIN prompts p ON p.folder_id = pf.id AND p.login_required = 0 AND p.user_id IN (SELECT id FROM users WHERE is_admin = 1)
      WHERE pf.user_id IN (SELECT id FROM users WHERE is_admin = 1)
      GROUP BY pf.id
      ORDER BY pf.created_at
    `).all()
  }

  // 添加兼容字段
  for (const f of folders) {
    ;(f as any).folder_id = f.id
    ;(f as any).folder_name = f.name
  }

  return { folders }
})
