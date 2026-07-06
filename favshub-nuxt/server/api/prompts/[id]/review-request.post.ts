/**
 * POST /api/prompts/:id/review-request — 提交提示词修改审核请求
 * 普通用户修改管理员的公开提示词时使用
 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { createError, readBody, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const db = getRawDb()

  const { id } = getRouterParams(event)
  if (!id) throw createError({ statusCode: 400, data: { error: '无效的提示词 ID' } })

  const dbUser = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(auth.id) as { is_admin: number } | undefined
  const isAdmin = !!dbUser?.is_admin

  // 管理员不需要审核，直接走 PUT 接口
  if (isAdmin) throw createError({ statusCode: 400, data: { error: '管理员可直接编辑，无需提审' } })

  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
  if (!prompt) throw createError({ statusCode: 404, data: { error: '提示词不存在' } })

  // 只有管理员的公开提示词才需要审核
  const ownerIsAdmin = (db.prepare('SELECT is_admin FROM users WHERE id = ?').get(prompt.user_id) as any)?.is_admin
  if (!ownerIsAdmin) throw createError({ statusCode: 403, data: { error: '只能对管理员的公开提示词提交审核' } })

  const body = await readBody(event)
  const { title, description, content, tags } = body || {}

  if (!title || !content) throw createError({ statusCode: 400, data: { error: '标题和内容不能为空' } })

  const now = Date.now()
  const reviewId = `${now}_review_${auth.id}`

  db.prepare(`
    INSERT INTO prompt_review_requests (id, prompt_id, user_id, title, description, content, tags, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(reviewId, id, auth.id, title, description || '', content, JSON.stringify(tags || []), now)

  return { success: true, message: '已提交审核请求', review_id: reviewId }
})