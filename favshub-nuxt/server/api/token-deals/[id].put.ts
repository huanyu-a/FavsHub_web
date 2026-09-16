/**
 * PUT /api/token-deals/:id — 编辑通告
 * 作者或管理员可编辑。作者修改已通过审核的通告后需重新审核（状态回到 pending），
 * 管理员编辑保持原状态。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { validateDealPayload } from '../../utils/token-deals'

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, data: { error: '未登录' } })
  }
  const { user, isAdmin } = role

  const { id } = getRouterParams(event)
  const body = await readBody(event)

  const db = getRawDb()
  const deal = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(id) as any
  if (!deal) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }
  if (deal.user_id !== user.id && !isAdmin) {
    throw createError({ statusCode: 403, data: { error: '无权编辑此通告' } })
  }

  const result = validateDealPayload(body)
  if (!result.ok) {
    throw createError({ statusCode: 400, data: { error: result.error } })
  }
  const d = result.data

  const status = isAdmin
    ? deal.status
    : (deal.status === 'approved' ? 'pending' : deal.status)

  try {
    db.prepare(`
      UPDATE token_deals SET
        provider = ?, title = ?, url = ?, call_url = ?, quota = ?, models = ?,
        region = ?, quality = ?, source_tag = ?, expires_at = ?, note = ?,
        status = ?, reject_reason = '', updated_at = ?
      WHERE id = ?
    `).run(
      d.provider, d.title, d.url, d.callUrl, d.quota, JSON.stringify(d.models),
      d.region, d.quality, d.sourceTag, d.expiresAt, d.note,
      status, Date.now(), id,
    )
  } catch (err: any) {
    console.error('编辑 Token 白嫖通告失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '编辑失败' } })
  }

  return {
    success: true,
    status,
    message: status === 'pending' && deal.status === 'approved'
      ? '已保存，内容变更需管理员重新审核'
      : '已保存',
  }
})
