/**
 * POST /api/deal-subscriptions — 创建订阅（游客，无账号）
 *
 * 游客无账号，凭返回的 `sub_token` 访问自己的订阅；`sub_token` **只在这里出现一次**。
 *
 * 站点**不投递**：创建订阅只是记下「关心什么」，真正的推送由游客自己的 Hermes
 * （定时拉 changes / feed，然后 `hermes send` 到他的 QQ 群）完成 —— 所以这里
 * 既不需要人机校验（调用方是脚本，过不了 Turnstile），也不需要地址验证（站点不发消息）。
 * 滥用面仅为「写库」，用「每 IP 每天 N 条」限死。
 *
 * Body: { label?, filters?: { kinds?, providers?, regions?, keywords? } }
 */
import { getRawDb } from '../../database'
import { getConfig, getConfigInt } from '../../utils/config'
import { checkRateLimit, getClientIP } from '../../utils/rate-limit'
import {
  newSubToken, newSubscriptionId, normalizeFilters, hashIp, subscriptionView,
} from '../../utils/deal-subscriptions'

export default defineEventHandler(async (event) => {
  if (getConfig('deal_sub_enabled') === 'false') {
    throw createError({ statusCode: 404, data: { error: '订阅功能未开放' } })
  }

  const ip = getClientIP(event)
  const perDay = Math.max(1, getConfigInt('deal_sub_per_ip_per_day', 3))
  checkRateLimit(`deal_sub:${hashIp(ip)}`, perDay, 24 * 60 * 60 * 1000)

  const body = await readBody(event).catch(() => ({} as any))
  const label = String(body?.label ?? '').trim().slice(0, 40)
  const filters = normalizeFilters(body?.filters)

  const db = getRawDb()
  const id = newSubscriptionId()
  const token = newSubToken()
  const now = Date.now()

  db.prepare(`
    INSERT INTO deal_subscriptions (
      id, sub_token, label, filters, status, cursor, pull_count, last_pull_at,
      created_ip_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', 0, 0, NULL, ?, ?, ?)
  `).run(id, token, label, JSON.stringify(filters), hashIp(ip), now, now)

  const row = db.prepare('SELECT * FROM deal_subscriptions WHERE id = ?').get(id) as any
  const config = useRuntimeConfig(event)
  const baseUrl = String(config.public?.baseUrl || '').replace(/\/+$/, '')

  // 首次基线：让游客立刻知道该从哪个 seq 开始，避免把历史当新事件
  const base = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM token_deal_events').get() as any

  return {
    success: true,
    sub_token: token,
    sub_token_notice: '请妥善保存：站点只在此处返回一次，之后只能用脱敏值核对。',
    subscription: subscriptionView(row, { baseUrl }),
    baseline_seq: Number(base?.seq || 0),
    message: '订阅已创建。首次接入请用 baseline_seq 作为起点（或调 changes?tail=1 取基线）。',
  }
})
