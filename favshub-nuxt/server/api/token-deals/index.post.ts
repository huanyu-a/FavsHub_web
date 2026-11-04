/**
 * POST /api/token-deals — 发布 Token 白嫖通告
 * Body: { provider, title, url, call_url, quota, models[], region, quality, source_tag, expires_at, note,
 *         real_name, real_name_other, summary, limits, requirements, verify_scope, faq[], featured? }
 *
 * `featured`（精选对比）**仅管理员**可写，普通用户传了静默忽略（见 `readFeaturedIntent`）。
 * `source_url`（情报来源，运营字段）**不接受**任何身份写入 —— 只由导入脚本直连 DB 写。
 *
 * 三条通道：
 *   - 管理员：直接上线；
 *   - 登录用户：进入 pending，待管理员审核；
 *   - **游客（未登录）**：走游客通道（guest-deals.ts，需昵称 + 人机校验），
 *     同样落库 pending，待管理员审核 —— 防滥用由「人机校验 + 限频 + 内容过滤 + 后置审核」兜底。
 *
 * 游客额外字段：{ nickname, turnstile_token }（Cloudflare Turnstile 一次性令牌），
 * 登录用户的请求体里出现这些字段时会被忽略（字段级校验只读白名单）。
 * 令牌缺失 / 过期 / 校验失败 / siteverify 不可用 → 一律拒绝（fail-closed，无降级通道）。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import { validateDealPayload, newDealId } from '../../utils/token-deals'
import { appendDealEvent } from '../../utils/deal-events'
import { submitGuestDeal } from '../../utils/guest-deals'
import { notifyTokenDealPending, notifyTokenDealPublished } from '../../utils/qq-notify'

/**
 * 读取「精选对比」写入意图 —— **仅管理员**可写（与 `pinned` 同口径）。
 *
 * 新建时默认 0，故只关心三态里的两态：非管理员 / 未传 → 0；管理员显式传 → 按值。
 * 普通用户传了 `featured` **静默忽略**（保持默认 0），不 403：
 * 与本站既有惯例一致 —— 游客请求体里出现 `nickname` / `turnstile_token` 时
 * 「字段级校验只读白名单」直接忽略；`pinned` 也从不作为载荷字段下发。
 * 报 403 会把「表单多带了一个开关」变成硬失败，而忽略不产生任何越权效果（值恒为 0）。
 */
function readFeaturedIntent(body: any, isAdmin: boolean): boolean {
  if (!isAdmin) return false
  if (body?.featured === undefined || body?.featured === null) return false
  return body.featured === true || body.featured === 1 || body.featured === '1' || body.featured === 'true'
}

export default defineEventHandler(async (event) => {
  const role = getAuthRole(event)
  const body = await readBody(event)
  const db = getRawDb()

  // ── 游客通道：无有效登录令牌 ──
  if (!role) {
    const result = await submitGuestDeal(db, event, body)
    if (!result.ok) {
      throw createError({ statusCode: result.status, data: { error: result.error } })
    }
    // QQ 机器人通知（fire-and-forget：失败只告警，绝不阻断主请求）
    try {
      notifyTokenDealPending(result.data, `游客·${result.data.nickname}`)
    } catch (err: any) {
      console.warn('[QQBot] 通告提交通知入队失败（忽略）:', err?.message || err)
    }
    return {
      success: true,
      deal_id: result.data.dealId,
      status: 'pending',
      message: '已提交，等待管理员审核',
    }
  }

  const { user, isAdmin } = role

  const result = validateDealPayload(body)
  if (!result.ok) {
    throw createError({ statusCode: 400, data: { error: result.error } })
  }
  const d = result.data

  const id = newDealId()
  const now = Date.now()
  const status = isAdmin ? 'approved' : 'pending'
  // 2026-11-04：新建时同时写 state。
  // 管理员建 = 已发布（这是他自己的发布行为）；普通用户建 = 待审核。
  // 不写的话 state 会停在列默认值 'pending'，导致「管理员建的条目在公开列表里看不到」。
  const state = isAdmin ? 'published' : 'pending'
  // 精选对比：仅管理员可置 1（普通用户传了忽略，见 readFeaturedIntent）
  const featured = readFeaturedIntent(body, isAdmin) ? 1 : 0

  try {
    // ⚠️ 列清单是**三处共用**的（本文件 / `[id].put.ts` / `ai-service.ts`）：
    // 新增可写字段时三处的 INSERT / UPDATE 列都要补，少改一处会「校验通过但没写库」。
    // `source_url` **刻意不在列清单**：运营字段，只由导入脚本直连 DB 写入，写接口一律拒收。
    db.prepare(`
      INSERT INTO token_deals (
        id, user_id, provider, title, url, call_url, quota, models, region, quality,
        source_tag, category, expires_at, pinned, note, real_name, real_name_other,
        summary, limits, requirements, verify_scope, faq, featured,
        status, state, reject_reason,
        vote_up, vote_down, rating_sum, rating_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, 0, 0, 0, ?, ?)
    `).run(
      id, user.id, d.provider, d.title, d.url, d.callUrl, d.quota,
      JSON.stringify(d.models), d.region, d.quality, d.sourceTag, d.category,
      d.expiresAt, d.note, d.realName, d.realNameOther,
      d.summary, d.limits, d.requirements, d.verifyScope, JSON.stringify(d.faq), featured,
      status, state, now, now,
    )
  } catch (err: any) {
    console.error('发布 Token 白嫖通告失败:', err)
    throw createError({ statusCode: 500, data: { error: err.message || '发布失败' } })
  }

  // 管理员直接上线 → 对外「上新」事件（登录用户落 pending，不产生事件）
  if (isAdmin) {
    appendDealEvent(db, id, 'online')
  }

  // QQ 机器人通知（fire-and-forget：失败只告警，绝不阻断主请求）
  //
  // 2026-10-30 修：这里原先传的是**提交载荷** `d`（camelCase、没有 id），
  // 于是「新通告发布」这条通知永远拼不出详情链接，到期行也读不到。
  // 统一改成与 approve / delete 路径同一形状：**带 id 的库行**。
  // 注意库行里含 verified_by / guest_fingerprint / deleted_by 等内部列 ——
  // 通知正文的白名单在 `utils/qq-notify.ts`（与 deal-events 共用归一化），
  // 本文件只负责给对形状，脱敏由那一层单点负责。
  try {
    const row = db.prepare('SELECT * FROM token_deals WHERE id = ?').get(id)
    if (isAdmin) {
      notifyTokenDealPublished(row)
    } else {
      notifyTokenDealPending(row, user.username)
    }
  } catch (err: any) {
    console.warn('[QQBot] 通告提交通知入队失败（忽略）:', err?.message || err)
  }

  return {
    success: true,
    deal_id: id,
    status,
    message: isAdmin ? '已发布' : '已提交，等待管理员审核',
  }
})
