/**
 * QQ 机器人指令路由与权限矩阵（OneBot 11 入站指令 → 回复文案）
 *
 * 身份判定：发送者 QQ 号 → qq_bindings → users.is_admin，三档：
 *   游客（未绑定）/ 普通用户（已绑定非管理员）/ 管理员（已绑定且 is_admin）。
 *
 * 通道规则（安全要求）：
 *   - 群内管理员发**任何**指令 → 固定回复「⚙️ 管理指令请私聊机器人办理」；
 *   - 群内个人指令（绑定/解绑/我的投稿/待审/通过/驳回）→ 回复「请私聊机器人办理」；
 *   - 绑定动作只发生在私聊（网站侧只生成码），绑定码本身就是凭据，避免抢绑。
 *
 * 「通过 / 驳回」复用 reviewDealById —— 与 admin review 端点完全相同的
 * 写库语义与 §B4 通知链路（群播 + 私聊作者），避免逻辑复制。
 */
import { getRawDb } from '../database'
import { isAdminUser } from './auth'
import { escapeCqText } from './qq-notify'
import { escapeLike, reviewDealById } from './token-deals'
import { consumeBindCode } from './qq-bind-codes'

/** 通告状态 → 中文标签 */
const DEAL_STATUS_LABELS: Record<string, string> = {
  pending: '⏳ 待审',
  approved: '✅ 已发布',
  rejected: '❌ 未通过',
}

/** 机器人可识别的指令词（首词命中才处理，其余消息不回复） */
const COMMAND_WORDS = ['帮助', '最新通告', '通告统计', '我的投稿', '绑定', '解绑', '待审', '通过', '驳回'] as const

export interface BotCommandContext {
  channel: 'group' | 'private'
  /** 群聊时的群号（private 时为空） */
  groupId?: string
  /** 发送者 QQ 号 */
  senderQQ: string
  /** 已剥离头部 @CQ 码并 trim 的指令文本 */
  text: string
}

interface BotIdentity {
  bound: boolean
  userId: number
  username: string
  isAdmin: boolean
}

const GUEST_IDENTITY: BotIdentity = { bound: false, userId: 0, username: '', isAdmin: false }

/** 发送者 QQ 号 → 绑定 → 站点用户（未绑定为游客身份） */
function resolveIdentity(senderQQ: string): BotIdentity {
  try {
    const db = getRawDb()
    const bind = db.prepare('SELECT user_id FROM qq_bindings WHERE qq_number = ?')
      .get(senderQQ) as { user_id: number } | undefined
    if (!bind) return GUEST_IDENTITY
    const user = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?')
      .get(bind.user_id) as { id: number; username: string; is_admin: number } | undefined
    if (!user) return GUEST_IDENTITY
    // 管理员判定与 requireAdmin/getAuthRole 同口径：users.is_admin 或 NUXT_ADMIN_USERS 环境名单
    return { bound: true, userId: user.id, username: user.username, isAdmin: isAdminUser(user) }
  } catch {
    return GUEST_IDENTITY
  }
}

// ── 公开指令（游客可用）──────────────────────────────────────

/** 帮助 — 按身份与通道列出可用指令（群内不展示管理指令） */
function helpText(identity: BotIdentity, channel: 'group' | 'private'): string {
  const lines = [
    '🤖 FavsHub 机器人指令：',
    '· 最新通告 [N] — 查看最新 N 条通告（默认 5，上限 10）',
    '· 通告统计 — 已发布总数与今日新增',
  ]
  if (channel === 'private') {
    if (!identity.bound) {
      lines.push('· 绑定 <码> — 绑定网站账号（在网站个人面板生成绑定码）')
    } else {
      lines.push(
        '· 我的投稿 — 查看我最近 5 条投稿',
        '· 解绑 — 解除 QQ 绑定',
      )
    }
    if (identity.isAdmin) {
      lines.push(
        '· 待审 — 查看待审数量',
        '· 通过 <ID前缀> — 审核通过通告',
        '· 驳回 <ID前缀> [原因] — 驳回通告',
      )
    }
  }
  return lines.join('\n')
}

/** 最新通告 [N] — 已发布通告按 created_at 倒序（默认 5，上限 10），不含 note 等内部字段 */
function latestDeals(args: string): string {
  const parsed = parseInt(args.trim(), 10)
  const n = Math.min(Math.max(Number.isNaN(parsed) ? 5 : parsed, 1), 10)
  const db = getRawDb()
  const rows = db.prepare(
    "SELECT title, provider, vote_up FROM token_deals WHERE status = 'approved' ORDER BY created_at DESC LIMIT ?"
  ).all(n) as { title: string; provider: string; vote_up: number }[]
  if (!rows.length) return '📭 暂无已发布通告'
  const lines = rows.map((r, i) => `${i + 1}. ${escapeCqText(r.title)} · ${escapeCqText(r.provider)} · ▲${r.vote_up ?? 0}`)
  return `📢 最新通告：\n${lines.join('\n')}`
}

/** 通告统计 — 已发布总数 + 今日新增（公开口径） */
function dealStats(): string {
  const db = getRawDb()
  const total = (db.prepare("SELECT COUNT(*) AS c FROM token_deals WHERE status = 'approved'").get() as { c: number }).c
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const today = (db.prepare(
    "SELECT COUNT(*) AS c FROM token_deals WHERE status = 'approved' AND created_at >= ?"
  ).get(startOfDay.getTime()) as { c: number }).c
  return `📊 通告统计：已发布 ${total} 条，今日新增 ${today} 条`
}

// ── 个人指令（仅私聊）───────────────────────────────────────

/** 我的投稿 — 本人最近 5 条通告的标题 + 状态（中文） */
function myDeals(userId: number): string {
  const db = getRawDb()
  const rows = db.prepare(
    'SELECT title, status FROM token_deals WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
  ).all(userId) as { title: string; status: string }[]
  if (!rows.length) return '📭 你还没有投稿过通告'
  const lines = rows.map(r => `· ${escapeCqText(r.title)}（${DEAL_STATUS_LABELS[r.status] || r.status}）`)
  return `📮 我的投稿（最近 ${rows.length} 条）：\n${lines.join('\n')}`
}

/** 绑定 <code> — 校验绑定码 → INSERT/UPDATE qq_bindings（码本身即凭据，仅私聊） */
function bindAccount(senderQQ: string, code: string): string {
  if (!code) return '用法：绑定 <6位绑定码>（在网站个人面板生成）'
  const result = consumeBindCode(code)
  if (!result.ok) return `❌ ${result.error}`

  const db = getRawDb()
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?')
    .get(result.userId) as { id: number; username: string } | undefined
  if (!user) return '❌ 绑定码对应的网站账号不存在'

  // 当前 QQ 已绑定其他账号 → 拒绝（一个 QQ 只能绑一个账号）
  const occupied = db.prepare('SELECT user_id FROM qq_bindings WHERE qq_number = ?')
    .get(senderQQ) as { user_id: number } | undefined
  if (occupied && occupied.user_id !== user.id) {
    return '❌ 当前 QQ 已绑定其他账号，请先解绑后再绑定新账号'
  }

  // 同一用户换绑新 QQ：删除旧绑定行再插入（INSERT/UPDATE 语义）
  const bind = db.transaction(() => {
    db.prepare('DELETE FROM qq_bindings WHERE user_id = ?').run(user.id)
    db.prepare('INSERT INTO qq_bindings (user_id, qq_number, created_at) VALUES (?, ?, ?)')
      .run(user.id, senderQQ, Date.now())
  })
  bind()
  return `✅ 已绑定账号 ${escapeCqText(user.username)}，现在可以用个人指令了`
}

/** 解绑 — 删除发送者 QQ 的绑定行 */
function unbindAccount(senderQQ: string): string {
  const db = getRawDb()
  const result = db.prepare('DELETE FROM qq_bindings WHERE qq_number = ?').run(senderQQ)
  if (result.changes === 0) return 'ℹ️ 当前 QQ 尚未绑定任何账号'
  return '✅ 已解绑，绑定关系已解除'
}

// ── 管理指令（仅私聊 + 管理员）───────────────────────────────

/** 待审 — 四类待审数量（口径与 /api/admin/stats 一致：排除自己给自己的提案/评测） */
function pendingSummary(): string {
  const db = getRawDb()
  let deals = 0
  let edits = 0
  let prompts = 0
  let guest = 0
  try {
    deals = (db.prepare("SELECT COUNT(*) AS c FROM token_deals WHERE status = 'pending'").get() as { c: number }).c
    edits = (db.prepare(`
      SELECT COUNT(*) AS c FROM token_deal_edits e JOIN token_deals d ON d.id = e.deal_id
      WHERE e.status = 'pending' AND e.user_id != d.user_id
    `).get() as { c: number }).c
    prompts = (db.prepare("SELECT COUNT(*) AS c FROM prompt_review_requests WHERE status = 'pending'").get() as { c: number }).c
    guest = (db.prepare(`
      SELECT COUNT(*) AS c FROM token_deal_guest_reviews g JOIN token_deals d ON d.id = g.deal_id
      WHERE g.status = 'pending' AND (g.user_id IS NULL OR g.user_id != d.user_id)
    `).get() as { c: number }).c
  } catch { /* 表未迁移时按 0 处理 */ }
  return [
    '📋 当前待审：',
    `· 待审通告：${deals} 条`,
    `· 待审修改建议：${edits} 条`,
    `· 待审提示词审核：${prompts} 条`,
    `· 待审游客评测：${guest} 条`,
  ].join('\n')
}

/**
 * 通过 <id前缀> / 驳回 <id前缀> [原因] — 按 id LIKE '<前缀>%' 匹配通告，
 * 命中数 ≠1 时报错提示加长前缀；命中后复用 reviewDealById（写库语义 + 通知链路与 admin review 端点一致）。
 */
function reviewByPrefix(action: 'approve' | 'reject', args: string): string {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const prefix = parts.shift() || ''
  if (!prefix) return `用法：${action === 'approve' ? '通过' : '驳回'} <ID前缀>${action === 'reject' ? ' [原因]' : ''}`
  // 通告 ID 只含字母数字下划线连字符，白名单校验天然防 LIKE 通配符注入
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(prefix)) return '⚠️ ID 前缀格式不正确'

  const db = getRawDb()
  const rows = db.prepare("SELECT id FROM token_deals WHERE id LIKE ? ESCAPE '\\'").all(escapeLike(prefix) + '%') as { id: string }[]
  if (rows.length === 0) return '⚠️ 未匹配到通告，请检查 ID 前缀'
  if (rows.length > 1) return `⚠️ 前缀「${prefix}」匹配到 ${rows.length} 条通告，请加长前缀`

  const reason = parts.join(' ')
  const result = reviewDealById(rows[0].id, action, reason)
  if (!result.ok) return `❌ ${result.error}`
  return action === 'approve'
    ? `✅ 已发布通告《${escapeCqText(result.deal.title)}》`
    : `❌ 已驳回通告《${escapeCqText(result.deal.title)}》${reason ? '：' + escapeCqText(reason) : ''}`
}

// ── 路由入口 ────────────────────────────────────────────────

/**
 * 处理机器人指令，返回回复文案；非指令消息返回 null（不回复）。
 * 永不抛出 —— 调用方（入站端点）恒返回 { status: 'ok' }。
 */
export function handleBotCommand(ctx: BotCommandContext): string | null {
  try {
    const text = String(ctx.text || '').trim()
    if (!text) return null
    const parts = text.split(/\s+/)
    const word = parts[0]
    if (!COMMAND_WORDS.includes(word as any)) return null
    const args = parts.slice(1).join(' ')

    const identity = resolveIdentity(ctx.senderQQ)

    // 安全要求：管理员在群内发任何指令 → 固定引导回私聊
    if (ctx.channel === 'group' && identity.isAdmin) {
      return '⚙️ 管理指令请私聊机器人办理'
    }

    const isGroup = ctx.channel === 'group'
    const personalOnly = word === '我的投稿' || word === '绑定' || word === '解绑' || word === '待审' || word === '通过' || word === '驳回'

    // 群内个人指令 → 引导私聊
    if (isGroup && personalOnly) {
      return '请私聊机器人办理'
    }

    switch (word) {
      // ── 公开指令（游客即可用）──
      case '帮助':
        return helpText(identity, ctx.channel)
      case '最新通告':
        return latestDeals(args)
      case '通告统计':
        return dealStats()

      // ── 个人指令（仅私聊）──
      case '绑定':
        return bindAccount(ctx.senderQQ, args)
      case '解绑':
        return unbindAccount(ctx.senderQQ)
      case '我的投稿':
        if (!identity.bound) {
          return 'ℹ️ 你还未绑定账号：请在网站个人面板生成绑定码，然后私聊发送「绑定 <码>」'
        }
        return myDeals(identity.userId)

      // ── 管理指令（仅私聊 + 管理员）──
      case '待审':
      case '通过':
      case '驳回':
        if (!identity.bound || !identity.isAdmin) {
          return '⚠️ 该指令仅限已绑定的管理员在私聊中使用'
        }
        if (word === '待审') return pendingSummary()
        return reviewByPrefix(word === '通过' ? 'approve' : 'reject', args)
    }
    return null
  } catch (err: any) {
    console.warn('[QQBot] 指令处理失败（忽略）:', err?.message || err)
    return null
  }
}
