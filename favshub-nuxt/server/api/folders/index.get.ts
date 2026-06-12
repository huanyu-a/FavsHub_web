/**
 * GET /api/folders — 获取文件夹列表
 * 游客：管理员的文件夹
 * 管理员：全部
 * 普通登录用户：自己的 + 管理员的
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const db = getRawDb()

  let folders: any[]
  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    if (dbUser?.is_admin) {
      folders = db.prepare('SELECT * FROM folders ORDER BY sort_order, created_at').all()
    } else {
      folders = db.prepare(
        'SELECT * FROM folders WHERE user_id = ? OR user_id IN (SELECT id FROM users WHERE is_admin = 1) ORDER BY sort_order, created_at'
      ).all(user.id)
    }
  } else {
    folders = db.prepare(
      'SELECT * FROM folders WHERE user_id IN (SELECT id FROM users WHERE is_admin = 1) ORDER BY sort_order, created_at'
    ).all()
  }

  return { folders }
})
