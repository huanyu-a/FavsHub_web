/**
 * DELETE /api/qq/bind-code — 解绑当前用户的 QQ（需登录）
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  db.prepare('DELETE FROM qq_bindings WHERE user_id = ?').run(user.id)

  return { success: true, bound: null }
})
