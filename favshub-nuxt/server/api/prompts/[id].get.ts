/**
 * GET /api/prompts/:id — 获取单个提示词（含标签和版本）
 */
import { getRawDb } from '../../database'
import { optionalAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = optionalAuth(event)
  const { id } = getRouterParams(event)

  const db = getRawDb()

  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) {
    throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
  }

  // 可见性检查
  // 管理员：全部
  // 普通用户：自己的 + 管理员公开的
  // 游客：管理员的公开提示词
  //
  // ⚠️ 软删除（回收站）必须单独判，且**优先生效**（2026-10-30 四轮补）：
  // `DELETE /api/prompts/:id` 是软删除（`deleted_at = now`），语义是「移入回收站」。
  // 但原实现只判归属与 `login_required`，**完全不看 `deleted_at`** —— 于是：
  //   · 匿名/他人可以读到已删除提示词的**完整正文**（详情 200）；
  //   · 匿名还能用 `?recycle=1` 枚举出「管理员已删除的公开提示词」并拿到 id。
  // 对照 `token_deals` 那边是 `deleted_at && !isAdmin` → 404，这里漏了同一层。
  //
  // 规则（与 token_deals 同口径）：**作者本人与管理员仍可读**，好让作者在回收站里
  // 看清内容再决定「恢复 / 彻底删除」；其他人一律 404（不是 403 —— 403 会泄露「这条存在」）。
  const isOwnerAdmin = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(prompt.user_id) as { is_admin: number } | undefined
  if (user) {
    const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined
    const isAdminViewer = !!dbUser?.is_admin
    if (prompt.deleted_at && !isAdminViewer && prompt.user_id !== user.id) {
      throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
    }
    if (isAdminViewer) {
      // 管理员可以看全部
    } else if (prompt.user_id === user.id) {
      // 自己的
    } else if (isOwnerAdmin?.is_admin && !prompt.login_required) {
      // 管理员公开的
    } else {
      throw createError({ statusCode: 403, data: { error: '无权访问此提示词' } })
    }
  } else {
    // 游客：已软删除的一律不可见（连「存在性」也不透露）
    if (prompt.deleted_at) {
      throw createError({ statusCode: 404, data: { error: '提示词不存在' } })
    }
    if (!isOwnerAdmin?.is_admin || prompt.login_required) {
      throw createError({ statusCode: 403, data: { error: '无权访问此提示词' } })
    }
  }

  // 获取标签
  const tags = db.prepare(`
    SELECT t.id, t.name, t.color FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = ?
  `).all(id)

  // 获取版本列表
  const versions = db.prepare(`
    SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC
  `).all(id)

  prompt.prompt_id = prompt.id
  prompt.tags = tags
  prompt.versions = versions

  // 内部列不下发（2026-10-30 四轮）：与列表端点同口径。
  // `SELECT * FROM prompts` 会把 `deleted_at` 一起带出来。当前该列全库恒为 NULL
  // （提示词用 `login_required` 做可见性，没有软删除 UI），属**偶然安全**。
  // 上一轮只修了列表漏了这里 —— 「同一份数据被多个端点展开时，改一个必须验全部」。
  delete prompt.deleted_at

  return { prompt }
})
