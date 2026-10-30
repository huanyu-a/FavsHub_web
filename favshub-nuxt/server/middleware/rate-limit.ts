/**
 * 全站 API 分层 IP 限频中间件（T5）
 *
 * ## 作用域：只碰 `/api`
 *
 * 页面 SSR 与静态资源**完全不经过本中间件**（不是「限得松」，是根本不进函数）——
 * 限流中间件写错最容易造成的生产事故就是「限到自己的页面」，把正常浏览打成 429。
 * 所以作用域判定放在第一行，且**只做加法**：非 `/api` 一律 return。
 *
 * ## 为什么 `/api/health` 豁免
 *
 * 探活接口被限流 = 监控把自己打成「站点挂了」。既有 `/api/health` 只做
 * `SELECT 1`，无出站、无写库，不构成滥用面。豁免清单可用
 * `FAVSHUB_RL_SITE_EXEMPT`（逗号分隔的**精确路径**）覆盖。
 *
 * ## 分层阈值
 *
 * | 档位 | 判定 | 默认阈值 | 为什么 |
 * |------|------|----------|--------|
 * | asset | 精确命中资源类 GET（默认 `/api/favicon`） | 1200 次/分钟 | 浏览一页缺图标的书签会自然突发几十上百次请求，属于「正常浏览的呼吸」 |
 * | read | 其余 GET / HEAD | 600 次/分钟 | 站内导航每页只发个位数 API 请求，留足余量 |
 * | write | POST / PUT / PATCH / DELETE | 120 次/分钟 | 写操作才是滥用与刷库面，收紧一个量级 |
 *
 * 三个档位都是**每来源 IP**、**每档独立计数**；阈值与窗口长度都可用
 * `FAVSHUB_RL_SITE_*` 覆盖（见 `server/utils/rate-limit.ts` 的阈值表）。
 *
 * ## 取真实 IP：复用既有实现，不另起一套
 *
 * 全程走 `getClientIP()`（`server/utils/rate-limit.ts`）—— 它已处理「宝塔 nginx →
 * docker nginx → 应用」两层代理下的 `X-Real-IP` 采信条件（仅当直连对端是内网地址），
 * 以及 `NUXT_TRUST_PROXY` 的语义。**不要在这里自己读 x-forwarded-for/x-real-ip**：
 * 自造一份取 IP 逻辑 = 多一个「伪造头绕过限流」的入口。
 * 限流键用既有的 `rateKeyForIp()`（IPv6 收敛到 /64 后取 sha256 前 16 位），
 * 既防「换 IPv6 地址重置配额」，也不在内存里存明文 IP。
 *
 * ## 与各端点自带限频的关系
 *
 * 本中间件是**最外层兜底**，阈值刻意高于所有端点自带的业务限频
 * （登录 20/分钟、注册 10/分钟、订阅与事件流 60/小时、评测按小时计等），
 * 正常用户永远先撞到业务限频（语义更准确的 429），不会先撞到这里。
 *
 * ## 局限（内存实现）
 *
 * 重启即清空、多实例各算一份、键基数超过 `FAVSHUB_RL_MAX_KEYS` 时按最久未使用淘汰。
 * 详见 `favshub-nuxt/CLAUDE.md` 的「限流模型」一节。
 */
import { getRequestURL, type H3Event } from 'h3'
import {
  acquireRequestSlot, consumeWindow, getClientIP, getRateLimitConfig, rateLimitError, windowLabel,
} from '../utils/rate-limit'
import { rateKeyForIp } from '../utils/deal-subscriptions'

type Tier = 'asset' | 'read' | 'write'

const TIER_LABELS: Record<Tier, string> = {
  asset: '资源类读接口',
  read: '读接口',
  write: '写接口',
}

/**
 * 归一化路径后再做豁免 / 分档判定。
 *
 * 为什么必须归一化：同一张路由有多种等价写法（`//api/health`、`/api/health/`、
 * 百分号编码），而 vue-router / h3 是**先解码再匹配**的。不归一化就会出现
 * 「请求被路由到 /api/health，却没命中豁免清单」这类判定与现实脱节的情况。
 * 反过来（归一化后命中豁免、实际被路由到别处）不存在：豁免清单里的路径都是
 * 具体路由，且分档只影响限得松紧，不影响任何鉴权决策。
 */
function normalizePath(raw: string): string {
  let p = raw
  try {
    p = decodeURIComponent(p)
  } catch {
    // 非法编码：保留原串。这类路径由 h3 直接 400，不值得为它做特殊分支
  }
  p = p.replace(/\/{2,}/g, '/')
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return p || '/'
}

/** 精确路径命中（**不做前缀推导**：`/api/favicon` 不应放行 `/api/favicon-evil`） */
function hitsExact(path: string, list: string[]): boolean {
  for (const item of list) {
    if (normalizePath(item) === path) return true
  }
  return false
}

function tierOf(event: H3Event, path: string, assetPaths: string[]): Tier {
  if (hitsExact(path, assetPaths)) return 'asset'
  return event.method === 'GET' || event.method === 'HEAD' ? 'read' : 'write'
}

export default defineEventHandler((event) => {
  const cfg = getRateLimitConfig()
  if (!cfg.site.enabled) return

  const path = normalizePath(getRequestURL(event).pathname)

  // ① 只管 API：页面 SSR 与静态资源一律不进限流（见文件头说明）
  if (path !== '/api' && !path.startsWith('/api/')) return

  // ② CORS 预检不是客户端可控流量（浏览器自动发出），计进配额只会放大误伤
  if (event.method === 'OPTIONS') return

  // ③ 探活豁免
  if (hitsExact(path, cfg.site.exemptPrefixes)) return

  const ipKey = rateKeyForIp(getClientIP(event))
  const tier = tierOf(event, path, cfg.site.assetPrefixes)
  const limit = tier === 'write'
    ? cfg.site.writePerMin
    : tier === 'asset' ? cfg.site.assetPerMin : cfg.site.readPerMin

  const decision = consumeWindow(`site:${tier}:${ipKey}`, limit, cfg.site.windowMs)
  if (!decision.allowed) {
    throw rateLimitError(
      event,
      `全站 ${TIER_LABELS[tier]} 每 IP ${limit} 次/${windowLabel(cfg.site.windowMs)}`,
      decision.retryAfterSec,
    )
  }

  // 同 IP 并发上限：槽位只挂在响应 close 事件上释放 —— 中间件无法用 try/finally 包住下游，
  // 而 close 在「正常结束 / 抛错 / 客户端中途断开」三种情况下都会触发。
  const slot = acquireRequestSlot(event, `site_c:${ipKey}`, cfg.site.concurrency)
  if (!slot) {
    throw rateLimitError(
      event,
      `全站同 IP 并发上限 ${cfg.site.concurrency}`,
      1,
      '同一来源 IP 的在途请求过多，请稍后再试',
    )
  }
})
