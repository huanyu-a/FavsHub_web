/**
 * Token 白嫖通告 — 修改提案服务层
 *
 * 站点规则：**通告内容允许所有人修改，但需经「通告作者」或「管理员」审核。**
 * 管理员可处理所有用户的提案；作者只能处理自己通告上的提案。
 *
 * 设计要点：
 *   1. 提案存的是**字段级 patch**（只带被改字段），不是整条通告的快照 ——
 *      审核时以「当前库中内容」为底合并，避免提案期间主表其他字段的改动被提案覆盖回旧值。
 *   2. 提案通过前主表内容**完全不受影响**；通过时复用 `validateDealPayload` 整体校验。
 *   3. 同一人对同一通告**只保留一条 pending**（再次提交即覆盖旧的），历史已结案提案留痕。
 *   4. 本模块是 Web 端点与 AI 通道的**唯一实现**，两条链路只做错误映射，不各写一套规则。
 */
import type Database from 'better-sqlite3'
import {
  canReviewDeal,
  diffDealPatch,
  extractDealPatch,
  newEditId,
  validateDealPatch,
  type EditOpResult,
} from './token-deals'

type DB = Database.Database

/**
 * 审核视角 —— 两条链路的入参形状归一化。
 *
 * Web 端 `getAuthRole()` 返回 `{ user: { id }, isAdmin }`，
 * AI 通道则直接构造 `{ id, isAdmin }`。若不归一化，
 * 传错形状会让 `viewer.id` 变成 `undefined` → 写库时触发
 * `NOT NULL constraint failed`（已实际踩到）。这里统一收敛成 `{ id, isAdmin }`。
 */
export interface DealViewer {
  id: number
  isAdmin: boolean
}

/** 把 `{ id, isAdmin }` 或 `{ user: { id }, isAdmin }` 统一成 DealViewer；无法解析时返回 null */
export function normalizeViewer(input: any): DealViewer | null {
  if (!input) return null
  const id = input.id ?? input.user?.id
  if (typeof id !== 'number' || !Number.isFinite(id)) return null
  return { id, isAdmin: !!input.isAdmin }
}

/** 提案人的展示名 */
function displayName(row: any): string {
  return row?.nickname || row?.username || '匿名'
}

/** 安全解析提案 payload */
function parsePayload(raw: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(raw ?? '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 组装对外返回的提案对象。
 *
 * `diff` 是**相对当前主表内容**实时计算的 —— 因此若提案提交后主表又被直接改过，
 * diff 会自动收窄甚至变空，前端据此提示「与当前内容一致」，无需额外状态位。
 */
function serializeEdit(row: any, deal: any) {
  const payload = parsePayload(row.payload)
  const diff = diffDealPatch(deal, payload)
  return {
    id: row.id,
    deal_id: row.deal_id,
    user_id: row.user_id,
    proposer: displayName(row),
    comment: row.comment || '',
    status: row.status,
    reviewer_id: row.reviewer_id ?? null,
    reviewer: row.reviewer_name || null,
    reject_reason: row.reject_reason || '',
    payload,
    diff,
    /** 提案与当前内容无差异 —— 可能已被直接编辑吸收，或与他人提案重复 */
    is_noop: diff.length === 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** 取通告（含作者信息），不存在返回 null */
function loadDeal(db: DB, dealId: string) {
  return db.prepare('SELECT * FROM token_deals WHERE id = ?').get(dealId) as any
}

/** 读提案并附带提案人 / 审核人 / 所属通告 */
function loadEdit(db: DB, editId: string) {
  return db.prepare(`
    SELECT e.*, u.username, u.nickname, r.nickname AS reviewer_nickname, r.username AS reviewer_username,
           (r.nickname || r.username) AS reviewer_name
    FROM token_deal_edits e
    LEFT JOIN users u ON e.user_id = u.id
    LEFT JOIN users r ON e.reviewer_id = r.id
    WHERE e.id = ?
  `).get(editId) as any
}

/**
 * 提交修改提案。
 *
 * 权限：任何登录用户可对**可见的通告**提交 —— 未过审的通告只有作者与管理员可见，
 * 他人提交一律 404（不区分「不存在」与「无权限」，与全局隔离策略一致）。
 * 同一人对同一通告已有 pending 提案时**覆盖**（含 payload 与 comment），不新建行。
 */
export function submitDealEdit(
  db: DB,
  rawViewer: any,
  rawDealId: unknown,
  body: any,
): EditOpResult<{ edit: any; created: boolean; message: string }> {
  const viewer = normalizeViewer(rawViewer)
  if (!viewer) return { ok: false, status: 401, error: '未登录' }

  const dealId = String(rawDealId ?? '').trim()
  if (!dealId) return { ok: false, status: 400, error: '通告 ID 不能为空' }

  const deal = loadDeal(db, dealId)
  if (!deal) return { ok: false, status: 404, error: '通告不存在' }

  // 未过审的通告仅作者与管理员可见 —— 他人视同不存在
  if (deal.status !== 'approved' && !canReviewDeal(deal, viewer)) {
    return { ok: false, status: 404, error: '通告不存在' }
  }

  const patch = extractDealPatch(body)
  if (Object.keys(patch).length === 0) {
    return { ok: false, status: 400, error: '没有提供任何可修改字段' }
  }

  // 以当前库中内容为底合并后整体校验，规则与直接编辑完全一致
  const result = validateDealPatch(deal, patch)
  if (!result.ok) return { ok: false, status: 400, error: result.error }

  const diff = diffDealPatch(deal, patch)
  if (diff.length === 0) {
    return { ok: false, status: 400, error: '修改内容与当前一致，无需提交' }
  }

  const comment = String(body?.comment ?? '').trim().slice(0, 200)
  const now = Date.now()

  const existing = db.prepare(
    "SELECT id FROM token_deal_edits WHERE deal_id = ? AND user_id = ? AND status = 'pending'"
  ).get(dealId, viewer.id) as { id: string } | undefined

  if (existing) {
    db.prepare(
      'UPDATE token_deal_edits SET payload = ?, comment = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(patch), comment, now, existing.id)
    const edit = loadEdit(db, existing.id)
    return {
      ok: true,
      data: {
        edit: serializeEdit(edit, deal),
        created: false,
        message: '已更新你此前提交的修改建议，仍待审核',
      },
    }
  }

  const id = newEditId()
  db.prepare(`
    INSERT INTO token_deal_edits (
      id, deal_id, user_id, payload, comment, status, reviewer_id, reject_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, '', ?, ?)
  `).run(id, dealId, viewer.id, JSON.stringify(patch), comment, now, now)

  const edit = loadEdit(db, id)
  return {
    ok: true,
    data: {
      edit: serializeEdit(edit, deal),
      created: true,
      message: '修改建议已提交，等待审核',
    },
  }
}

/**
 * 列出某通告的提案。
 *
 * 可见性：作者/管理员看到**全部**（含已结案，供审核与追溯）；其他人只看到**自己的**。
 */
export function listDealEdits(
  db: DB,
  rawViewer: any,
  rawDealId: unknown,
  query: any,
): EditOpResult<{ edits: any[]; can_review: boolean }> {
  const viewer = normalizeViewer(rawViewer)

  const dealId = String(rawDealId ?? '').trim()
  if (!dealId) return { ok: false, status: 400, error: '通告 ID 不能为空' }

  const deal = loadDeal(db, dealId)
  if (!deal) return { ok: false, status: 404, error: '通告不存在' }

  const isReviewer = !!viewer && canReviewDeal(deal, viewer)
  const canRead = isReviewer || deal.status === 'approved'
  if (!canRead) return { ok: false, status: 404, error: '通告不存在' }

  const status = String(query?.status ?? '').trim()
  const where: string[] = ['e.deal_id = ?']
  const params: any[] = [dealId]

  if (status && status !== 'all') {
    where.push('e.status = ?')
    params.push(status)
  }
  if (!isReviewer) {
    // 非审核人只看自己的提案
    if (!viewer) return { ok: false, status: 401, error: '未登录' }
    where.push('e.user_id = ?')
    params.push(viewer.id)
  }

  const rows = db.prepare(`
    SELECT e.*, u.username, u.nickname, r.nickname AS reviewer_nickname, r.username AS reviewer_username,
           (r.nickname || r.username) AS reviewer_name
    FROM token_deal_edits e
    LEFT JOIN users u ON e.user_id = u.id
    LEFT JOIN users r ON e.reviewer_id = r.id
    WHERE ${where.join(' AND ')}
    ORDER BY e.status = 'pending' DESC, e.created_at DESC
    LIMIT 200
  `).all(...params) as any[]

  return {
    ok: true,
    data: {
      edits: rows.map(r => serializeEdit(r, deal)),
      can_review: isReviewer,
    },
  }
}

/**
 * 「待我审核」聚合列表 —— 作者看自己通告上的提案，管理员看全部用户的提案。
 *
 * 仅返回 `status='pending'`：已结案的提案在通告详情里追溯即可。
 */
export function listReviewableEdits(
  db: DB,
  rawViewer: any,
  query: any,
): EditOpResult<{ edits: any[]; total: number; scope: string }> {
  const viewer = normalizeViewer(rawViewer)
  if (!viewer) return { ok: false, status: 401, error: '未登录' }

  const limit = Math.min(100, Math.max(1, parseInt(query?.limit as string) || 50))
  const page = Math.max(1, parseInt(query?.page as string) || 1)
  const offset = (page - 1) * limit

  // 排除自己给自己的通告提的提案：那类由本人直接编辑更自然，留在待审队列里纯属噪音
  const where = ["e.status = 'pending'", 'e.user_id != d.user_id']
  const params: any[] = []
  if (!viewer.isAdmin) {
    where.push('d.user_id = ?')
    params.push(viewer.id)
  }

  const whereSql = where.join(' AND ')
  const total = (db.prepare(
    `SELECT COUNT(*) AS c FROM token_deal_edits e JOIN token_deals d ON d.id = e.deal_id WHERE ${whereSql}`
  ).get(...params) as { c: number }).c

  const rows = db.prepare(`
    SELECT e.*, u.username, u.nickname,
           d.provider AS deal_provider, d.title AS deal_title, d.status AS deal_status,
           d.user_id AS deal_user_id
    FROM token_deal_edits e
    JOIN token_deals d ON d.id = e.deal_id
    LEFT JOIN users u ON e.user_id = u.id
    WHERE ${whereSql}
    ORDER BY e.created_at ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  return {
    ok: true,
    data: {
      edits: rows.map((row) => ({
        id: row.id,
        deal_id: row.deal_id,
        user_id: row.user_id,
        proposer: displayName(row),
        comment: row.comment || '',
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deal: {
          id: row.deal_id,
          provider: row.deal_provider,
          title: row.deal_title,
          status: row.deal_status,
        },
        // 聚合列表里也要给 diff —— 审核人不必点进详情就能判断
        diff: diffDealPatch(
          db.prepare('SELECT * FROM token_deals WHERE id = ?').get(row.deal_id) as any,
          parsePayload(row.payload),
        ),
        payload: parsePayload(row.payload),
      })),
      total,
      scope: viewer.isAdmin ? 'all' : 'own',
    },
  }
}

/**
 * 审核提案。
 *
 * 权限：通告作者或管理员（管理员可审核所有用户的提案）。他人一律 404。
 *
 * 通过时的状态流转：
 *   - 以**当前库中内容**为底合并 patch → 复用 `validateDealPayload` 校验 → 落库；
 *   - 通告状态保持原样（审核即生效）；但若原状态是 `rejected`，
 *     说明作者/管理员已认可修复后的内容，回到 `pending` 交管理员过目 —— 否则这次通过毫无可见效果。
 */
export function reviewDealEdit(
  db: DB,
  rawViewer: any,
  rawEditId: unknown,
  body: any,
): EditOpResult<{ edit: any; deal_status: string; message: string }> {
  const viewer = normalizeViewer(rawViewer)
  if (!viewer) return { ok: false, status: 401, error: '未登录' }

  const editId = String(rawEditId ?? '').trim()
  if (!editId) return { ok: false, status: 400, error: '提案 ID 不能为空' }

  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    return { ok: false, status: 400, error: '审核动作必须是 approve 或 reject' }
  }

  const edit = loadEdit(db, editId)
  if (!edit) return { ok: false, status: 404, error: '提案不存在' }

  const deal = loadDeal(db, edit.deal_id)
  if (!deal) return { ok: false, status: 404, error: '通告不存在' }

  if (!canReviewDeal(deal, viewer)) {
    return { ok: false, status: 404, error: '提案不存在' }
  }
  if (edit.status !== 'pending') {
    return { ok: false, status: 409, error: `该提案已${edit.status === 'approved' ? '通过' : '驳回'}，无需重复审核` }
  }

  const now = Date.now()

  if (action === 'reject') {
    const reason = String(body?.reason ?? '').trim().slice(0, 200)
    db.transaction(() => {
      db.prepare(
        "UPDATE token_deal_edits SET status = 'rejected', reviewer_id = ?, reject_reason = ?, updated_at = ? WHERE id = ?"
      ).run(viewer.id, reason, now, editId)
    })()
    const updated = loadEdit(db, editId)
    return {
      ok: true,
      data: {
        edit: serializeEdit(updated, deal),
        deal_status: deal.status,
        message: '已驳回该修改建议',
      },
    }
  }

  // ── 通过：合并 patch 落库 ──
  const patch = parsePayload(edit.payload)
  const result = validateDealPatch(deal, patch)
  if (!result.ok) {
    return { ok: false, status: 400, error: `提案内容已无法通过校验：${result.error}` }
  }
  const d = result.data

  const nextStatus = deal.status === 'rejected' ? 'pending' : deal.status

  db.transaction(() => {
    db.prepare(`
      UPDATE token_deals SET
        provider = ?, title = ?, url = ?, call_url = ?, quota = ?, models = ?,
        region = ?, quality = ?, source_tag = ?, expires_at = ?, note = ?,
        status = ?, reject_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(
      d.provider, d.title, d.url, d.callUrl, d.quota, JSON.stringify(d.models),
      d.region, d.quality, d.sourceTag, d.expiresAt, d.note,
      nextStatus, nextStatus === 'pending' ? '' : deal.reject_reason, now, deal.id,
    )
    db.prepare(
      "UPDATE token_deal_edits SET status = 'approved', reviewer_id = ?, reject_reason = '', updated_at = ? WHERE id = ?"
    ).run(viewer.id, now, editId)
  })()

  const updatedEdit = loadEdit(db, editId)
  const updatedDeal = loadDeal(db, deal.id)
  return {
    ok: true,
    data: {
      edit: serializeEdit(updatedEdit, updatedDeal),
      deal_status: nextStatus,
      message: nextStatus === 'pending'
        ? '已通过并写入通告；该通告已回到待审队列'
        : '已通过并写入通告',
    },
  }
}

/** 撤回自己的提案（仅 pending 可撤回）；管理员可撤回任意 pending 提案 */
export function withdrawDealEdit(
  db: DB,
  rawViewer: any,
  rawEditId: unknown,
): EditOpResult<{ id: string }> {
  const viewer = normalizeViewer(rawViewer)
  if (!viewer) return { ok: false, status: 401, error: '未登录' }

  const editId = String(rawEditId ?? '').trim()
  if (!editId) return { ok: false, status: 400, error: '提案 ID 不能为空' }

  const edit = loadEdit(db, editId)
  if (!edit) return { ok: false, status: 404, error: '提案不存在' }

  if (edit.user_id !== viewer.id && !viewer.isAdmin) {
    return { ok: false, status: 404, error: '提案不存在' }
  }
  if (edit.status !== 'pending') {
    return { ok: false, status: 409, error: '只能撤回待审核的提案' }
  }

  db.prepare('DELETE FROM token_deal_edits WHERE id = ?').run(editId)
  return { ok: true, data: { id: editId } }
}

/**
 * 供详情端点使用：当前用户在此通告上的提案状态。
 *
 * 返回自己那条 pending 提案（若有）+ 待审提案总数 + 自己是否可审核。
 */
export function dealEditSummary(db: DB, rawViewer: any, deal: any) {
  const viewer = normalizeViewer(rawViewer)
  const canReview = !!viewer && canReviewDeal(deal, viewer)

  const pendingCount = (db.prepare(
    "SELECT COUNT(*) AS c FROM token_deal_edits WHERE deal_id = ? AND status = 'pending'"
  ).get(deal.id) as { c: number }).c

  let myEdit: any = null
  if (viewer) {
    const row = db.prepare(`
      SELECT e.*, u.username, u.nickname
      FROM token_deal_edits e
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.deal_id = ? AND e.user_id = ? AND e.status = 'pending'
    `).get(deal.id, viewer.id) as any
    if (row) myEdit = serializeEdit(row, deal)
  }

  return {
    can_review: canReview,
    pending_edit_count: pendingCount,
    my_edit: myEdit,
    /** 作者自己改自己的通告不需要走提案 —— 前端据此直接走编辑表单 */
    is_author: !!viewer && deal.user_id === viewer.id,
  }
}
