/**
 * GET /api/token-deals/:id — 通告详情
 * 附带当前用户的投票与评测状态；未审核通过的通告仅作者与管理员可见。
 * 附带 Nexus 接入信息（分享卡片需要展示实测可用率与耗时）；Nexus 表缺失时降级为 null，不阻断详情。
 * 附带修改建议摘要（`edits`）：自己那条待审提案、待审总数、自己是否可审核。
 * 附带游客评测摘要（`guest_review`）：当前访客自己那条待审评测（按 IP+UA 指纹识别）。
 */
import { getRawDb } from '../../database'
import { getAuthRole } from '../../utils/auth'
import {
  isPubliclyVisible, isVerifyStale, loadVerifications, INVALID_REASON_LABELS, verifyAgeDays,
} from '../../utils/token-deals'
import { dealEditSummary } from '../../utils/deal-edits'
import { guestReviewSummary } from '../../utils/guest-reviews'
import { myVoteFor } from '../../utils/deal-votes'
import { renderRichText } from '../../utils/rich-text'
import { claimUrlTemplateOf, hasAvailableInviteCode, hasClaimCodePlaceholder } from '../../utils/invite-codes'

function parseModels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

interface NexusInfo {
  channel_id: number
  name: string
  status: number
  enabled: boolean
  eval_ok: number
  eval_total: number
  eval_avg_ms: number
  eval_at: number
}

/** 读取通告的 Nexus 渠道信息；表未迁移（旧库）或查询异常时返回 null */
function loadNexusInfo(db: any, dealId: string): NexusInfo | null {
  try {
    const row = db.prepare(`
      SELECT n.channel_id, n.name, n.status, n.eval_ok, n.eval_total, n.eval_avg_ms, n.eval_at
      FROM nexus_deal_map m
      JOIN nexus_channels n ON n.channel_id = m.channel_id
      WHERE m.deal_id = ?
    `).get(dealId) as any
    if (!row) return null
    return {
      channel_id: row.channel_id,
      name: row.name,
      status: row.status,
      enabled: row.status === 1,
      eval_ok: row.eval_ok || 0,
      eval_total: row.eval_total || 0,
      eval_avg_ms: row.eval_avg_ms || 0,
      eval_at: row.eval_at || 0,
    }
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, data: { error: '缺少通告 ID' } })
  }

  const role = getAuthRole(event)
  const db = getRawDb()

  const row = db.prepare(`
    SELECT d.*,
      CASE WHEN d.guest_name IS NOT NULL AND d.guest_name != '' THEN d.guest_name ELSE u.nickname END AS nickname
    FROM token_deals d
    LEFT JOIN users u ON d.user_id = u.id
    WHERE d.id = ?
  `).get(id) as any

  if (!row) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  const isOwner = !!role && role.user.id === row.user_id
  const isAdmin = !!role?.isAdmin

  // 生命周期可见性：
  //   - 已删除：除管理员外一律 404（与列表 mine=1 隐藏已删除保持同一口径；
  //     作者想恢复需找管理员，防止被下架内容被作者自行「复活」）；
  //   - 已失效 / 已过期：作者与管理员仍可打开（作者需据此续期），对外 404。
  // 统一 404 而不区分「不存在」与「已下架」，避免向外部泄露条目存在性。
  if ((row.deleted_at && !isAdmin) || (!isPubliclyVisible(row) && !isOwner && !isAdmin)) {
    throw createError({ statusCode: 404, data: { error: '通告不存在或已失效' } })
  }

  // 未过审 / 已驳回：对作者与管理员之外一律 404。
  // 2026-10-30 审查后从 403 +「该通告尚未通过审核」改为 404：那个提示只有
  // **非作者非管理员**才看得到（作者在上面就放行了），等于向外部确认「这条存在但没批」，
  // 与本文件第 93 行「统一 404 不区分，避免泄露条目存在性」自相矛盾。
  if (row.status !== 'approved' && !isOwner && !isAdmin) {
    throw createError({ statusCode: 404, data: { error: '通告不存在' } })
  }

  // 我的投票：登录用户查原表，游客查游客表（投票已开放给游客，故不能只在 role 分支里取）
  const myVote = myVoteFor(db, event, id, role?.user.id ?? null)

  let myReview: { rating: number; content: string; updated_at: number | null } | null = null

  if (role) {
    const review = db.prepare(
      'SELECT rating, content, updated_at FROM token_deal_reviews WHERE deal_id = ? AND user_id = ?'
    ).get(id, role.user.id) as any
    myReview = review ?? null
  }

  // 修改建议摘要：表不存在（旧库未迁移）时降级为 null，不阻断详情
  let edits: ReturnType<typeof dealEditSummary> | null = null
  try {
    edits = dealEditSummary(db, role, row)
  } catch (err: any) {
    console.warn('[token-deals] 读取修改建议摘要失败:', err?.message)
  }

  // 游客评测摘要：当前访客自己那条待审评测（按 IP+UA 指纹识别，未登录也能回显）
  let guestReview: ReturnType<typeof guestReviewSummary> | null = null
  try {
    guestReview = guestReviewSummary(db, event, id)
  } catch (err: any) {
    console.warn('[token-deals] 读取游客评测摘要失败:', err?.message)
  }

  // 领取地址占位符（2026-10-30）：详情只回答「这条的领取地址要不要抽码」，
  // **不做任何替换** —— 详情响应里永远不出现码、也不出现 claim_url（码池不进详情是不变量，
  // 替换只发生在 GET /:id/invite-code 那次「已抽中」的响应里）。
  // `url` / `call_url` 仍是作者填的原文模板：编辑器要回填它，剥掉占位符就没法再编辑。
  const claim = claimUrlTemplateOf(row)

  return {
    deal: {
      ...row,
      models: parseModels(row.models),
      is_expired: !!row.expires_at && row.expires_at < Date.now(),
      is_deleted: !!row.deleted_at,
      is_invalid: !!row.invalid_at,
      invalid_reason_label: row.invalid_at ? (INVALID_REASON_LABELS[row.invalid_reason] || '已失效') : '',
      // 生命周期原始列不下发公开侧（2026-10-30 四轮）：前端只需要上面三个派生值
      // （`is_deleted` / `is_invalid` / `invalid_reason_label`），原始列是运营侧的审计信息。
      //
      // ⚠️ 不要以为「能读到详情就一定未删除未失效」——`canReadDeal()` 对**作者**有例外：
      //    自己的已过期 / 已失效通告仍可打开详情（据此续期），只有已删除的除管理员外一律 404。
      //    所以作者读到自己的失效通告时，`invalid_reason` 在库里**是有值的**，不是「恒为空」。
      //    实测当前 3 条已失效通告都属于管理员（自己看得到全部），但这个例外是代码保证的，
      //    不能靠「现在恰好没有普通作者的失效通告」来推理。
      //
      // 那剔除后作者还看得到失效原因吗？**能** —— 前端只消费派生值
      // `invalid_reason_label`（`TokenDealDetail.vue:81` 渲染「已失效（到期）」等中文标签），
      // 从不读原始 `invalid_reason`。剔除的是「机读枚举」，保留的是「人读文案」。
      //
      // 剔除的真正理由是「纵深防御」：这些列是运营审计信息（谁在何时删的、为什么判失效），
      // 一旦哪个新端点漏了 `canReadDeal()`，泄露的就是它们。
      // ⚠️ `reject_reason` **刻意保留**：作者要读到自己被驳回的原因才能改稿重提
      //    （`TokenDealDetail.vue` 的「未通过审核」区块），且驳回通告对非作者一律 404。
      deleted_at: undefined,
      invalid_reason: undefined,
      is_owner: isOwner,
      can_edit: isOwner || isAdmin,
      can_moderate: isAdmin,
      // 人工核验时间轴（2026-10-20）：核验人只给管理员看，公开侧只露出时间与备注
      verified_at: Number(row.verified_at || 0),
      // 2026-10-30 前端脱敏：核验人用户名**任何身份**都不再从公开详情下发。
      // 原实现写成 `isAdmin ? row.verified_by : ''`，于是管理员浏览公开前台时仍会看到用户名，
      // 与「前端不出现敏感信息」相悖。后台要看核验人请走 /api/admin/token-deals（本就有权限门）。
      verified_by: '',
      // 内部标识与操作人一律不下发公开侧：user_id 可关联到账号，deleted_by 是下架操作人
      user_id: undefined,
      deleted_by: undefined,
      // 游客指纹 = sha256(ip|ua)，与 server/utils/guest-reviews.ts 的身份识别是**同一算法**。
      // 一旦下发，任何人都能把「同一个匿名访客发过的所有通告」串起来，游客通道的匿名性就没了。
      // 2026-10-30 审查实测该字段确实出现在公开列表/详情（上面 `...row` 展开全列的锅）。
      // 注意 `guest_name` 要保留 —— 那是游客自填的展示名，与昵称同级，本来就公开。
      guest_fingerprint: undefined,
      verify_note: String(row.verify_note || ''),
      verify_age_days: verifyAgeDays(row),
      verify_stale: isVerifyStale(row),
      // 2026-10-30 备注富文本：服务端渲染 + 白名单消毒，只下发成品 HTML。
      // 备注是**普通用户可写**字段，前端绝不该对原文直接 v-html（XSS）。原始 `note` 仍保留给编辑器回填。
      note_html: renderRichText(row.note),
      // 邀请码（2026-10-30）：这里只告诉前端「还有没有可用码」，
      // 码本身走 GET /:id/invite-code 单独抽一个 —— 码池绝不随详情下发
      has_invite_code: hasAvailableInviteCode(db, id),
      // 领取地址的来源字段与「是否写了 {邀请码} 占位符」：
      // 前端据此提示「先抽码才有完整链接」，并在抽中后用响应里的 claim_url 跳转
      claim_url_source: claim.source,
      claim_url_has_placeholder: hasClaimCodePlaceholder(claim.template),
      nexus: loadNexusInfo(db, id),
    },
    // 公开侧只露「何时核验过」，不露核验人（后台才看得到）
    // 2026-10-30：actor 一律清空（不再按 isAdmin 放行），公开前台永不出现用户名
    verifications: loadVerifications(db, id, isAdmin ? 10 : 3)
      .map(v => ({ ...v, actor: '' })),
    edits,
    guest_review: guestReview,
    my_vote: myVote,
    my_review: myReview,
  }
})
