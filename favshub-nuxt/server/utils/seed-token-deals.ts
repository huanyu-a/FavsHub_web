/**
 * Token 白嫖通告 — 首装种子数据
 *
 * 首次部署（token_deals 表为空）时灌入一批社区常见免费额度通告，
 * 避免板块空转。所有条目均为「示例通告」，额度与规则以各官方页面为准。
 *
 * vote_up / vote_down / rating_sum / rating_count 为演示用缓存计数：
 * 该四列在真实投票或评测发生时由 syncDealCounters() 从明细表重算并覆盖。
 */
import type Database from 'better-sqlite3'
import { newDealId } from './token-deals'

interface SeedDeal {
  provider: string
  title: string
  url: string
  callUrl: string
  quota: string
  models: string[]
  region: 'cn' | 'global'
  quality: string
  sourceTag: 'official' | 'relay' | 'community'
  /** 距今天数；null 表示永久有效 */
  expiresInDays: number | null
  pinned: number
  note: string
  voteUp: number
  voteDown: number
  ratingSum: number
  ratingCount: number
}

export const DEFAULT_TOKEN_DEALS: SeedDeal[] = [
  {
    provider: '智谱 AI',
    title: '新用户注册赠送 2000 万 Tokens，GLM 全系可用',
    url: 'https://open.bigmodel.cn/',
    callUrl: 'https://open.bigmodel.cn/api/paas/v4',
    quota: '注册赠 2000 万 Tokens，有效期 1 年',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus', 'glm-4v'],
    region: 'cn',
    quality: '上上品',
    sourceTag: 'official',
    expiresInDays: null,
    pinned: 1,
    note: '国内直连无需代理，注册需实名。glm-4-flash 长期免费，适合做日常批处理。额度规则以官方页面为准，可能随时调整。',
    voteUp: 128,
    voteDown: 9,
    ratingSum: 246,
    ratingCount: 52,
  },
  {
    provider: 'ModelScope 魔搭',
    title: '每日 2000 次免费 API 调用，绑定阿里云账号即得',
    url: 'https://modelscope.cn/',
    callUrl: 'https://api-inference.modelscope.cn/v1',
    quota: '每日 2000 次调用，不限模型',
    models: ['Qwen3-235B', 'DeepSeek-V3', 'GLM-4.5', 'Kimi-K2'],
    region: 'cn',
    quality: '上上品',
    sourceTag: 'official',
    expiresInDays: null,
    pinned: 1,
    note: 'OpenAI 兼容接口，改 base_url 即可直连。每日 0 点重置，单次上下文有上限。适合做高频小请求。',
    voteUp: 156,
    voteDown: 11,
    ratingSum: 302,
    ratingCount: 64,
  },
  {
    provider: 'OpenRouter',
    title: '免费模型池：带 :free 后缀的模型零成本调用',
    url: 'https://openrouter.ai/',
    callUrl: 'https://openrouter.ai/api/v1',
    quota: '免费模型每日 50 次 / 充值 10 美元后 1000 次',
    models: ['deepseek/deepseek-chat-v3:free', 'meta-llama/llama-3.3-70b:free', 'qwen/qwen3-235b:free'],
    region: 'global',
    quality: '上品',
    sourceTag: 'relay',
    expiresInDays: null,
    pinned: 0,
    note: '海外聚合站，国内需代理。免费池模型会随时上下架，建议程序里做模型回退。免费额度仅限 :free 后缀模型。',
    voteUp: 94,
    voteDown: 27,
    ratingSum: 178,
    ratingCount: 41,
  },
  {
    provider: 'Google AI Studio',
    title: 'Gemini 免费层：每分钟 15 次请求，无需绑卡',
    url: 'https://aistudio.google.com/',
    callUrl: 'https://generativelanguage.googleapis.com/v1beta',
    quota: '免费层 15 RPM / 1500 RPD，Flash 系列不限总量',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    region: 'global',
    quality: '上上品',
    sourceTag: 'official',
    expiresInDays: null,
    pinned: 0,
    note: '需 Google 账号 + 海外网络环境。免费层数据会被用于改进产品，勿传敏感内容。接口与 OpenAI 不兼容，需单独适配。',
    voteUp: 143,
    voteDown: 14,
    ratingSum: 268,
    ratingCount: 55,
  },
  {
    provider: '硅基流动 SiliconFlow',
    title: '注册赠送 14 元余额，2000 万 Tokens 模型免费用',
    url: 'https://cloud.siliconflow.cn/',
    callUrl: 'https://api.siliconflow.cn/v1',
    quota: '注册赠 14 元；部分小模型永久免费',
    models: ['Qwen3-8B', 'GLM-4-9B', 'DeepSeek-R1-Distill'],
    region: 'cn',
    quality: '上品',
    sourceTag: 'official',
    expiresInDays: null,
    pinned: 0,
    note: '国内直连。赠送余额有有效期，优先用永久免费的小模型。并发限制较严，批量任务需自行限流。',
    voteUp: 87,
    voteDown: 12,
    ratingSum: 164,
    ratingCount: 36,
  },
  {
    provider: 'Groq',
    title: '免费层极速推理，Llama / Qwen 全系零成本',
    url: 'https://console.groq.com/',
    callUrl: 'https://api.groq.com/openai/v1',
    quota: '免费层按模型限速（如 30 RPM / 14400 RPD）',
    models: ['llama-3.3-70b-versatile', 'qwen-3-32b', 'moonshotai/kimi-k2'],
    region: 'global',
    quality: '上品',
    sourceTag: 'official',
    expiresInDays: null,
    pinned: 0,
    note: '推理速度极快，适合做实时补全。海外节点，国内需代理。免费层每日 token 总量有硬上限，跑满会 429。',
    voteUp: 76,
    voteDown: 15,
    ratingSum: 142,
    ratingCount: 31,
  },
  {
    provider: 'Cloudflare Workers AI',
    title: '每日 10,000 Neurons 免费额度，边缘节点直接调用',
    url: 'https://developers.cloudflare.com/workers-ai/',
    callUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run',
    quota: '每日 10,000 Neurons 免费',
    models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/qwen/qwen1.5-14b-chat-awq'],
    region: 'global',
    quality: '中品',
    sourceTag: 'official',
    expiresInDays: null,
    pinned: 0,
    note: 'Neurons 按模型大小计费，大模型消耗很快。适合轻量任务。需要在 Workers 里绑定，纯 HTTP 调用稍麻烦。',
    voteUp: 58,
    voteDown: 9,
    ratingSum: 104,
    ratingCount: 24,
  },
  {
    provider: '阿里云百炼',
    title: '新用户每个模型 100 万 Tokens 免费额度',
    url: 'https://bailian.console.aliyun.com/',
    callUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    quota: '每个模型 100 万 Tokens，有效期 180 天',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    region: 'cn',
    quality: '上品',
    sourceTag: 'official',
    expiresInDays: 180,
    pinned: 0,
    note: '国内直连，OpenAI 兼容模式。按模型分别赠送，可叠加使用。需实名认证，额度有 180 天有效期，注意别放过期。',
    voteUp: 69,
    voteDown: 8,
    ratingSum: 128,
    ratingCount: 27,
  },
  {
    provider: '火山方舟（豆包）',
    title: '每个模型赠送 50 万 Tokens，Doubao 全系免费试',
    url: 'https://console.volcengine.com/ark',
    callUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    quota: '每个模型 50 万 Tokens 免费额度',
    models: ['doubao-seed-1.6', 'doubao-1.5-pro-32k', 'doubao-1.5-lite'],
    region: 'cn',
    quality: '上品',
    sourceTag: 'official',
    expiresInDays: 90,
    pinned: 0,
    note: '国内直连，OpenAI 兼容。开通推理接入点后即可调用，需先创建 endpoint。额度按模型独立计算。',
    voteUp: 61,
    voteDown: 10,
    ratingSum: 112,
    ratingCount: 25,
  },
  {
    provider: '某中转站',
    title: '社区转发：注册送 5 美元额度，多模型聚合',
    url: 'https://example.com/relay-signup',
    callUrl: 'https://example.com/v1',
    quota: '注册赠 5 美元，按官方价 0.8 折计费',
    models: ['gpt-4o-mini', 'claude-haiku', 'gemini-flash'],
    region: 'cn',
    quality: '下品',
    sourceTag: 'community',
    expiresInDays: 30,
    pinned: 0,
    note: '⚠️ 中转站稳定性与数据安全无法保证，切勿传入隐私或商业敏感内容。此类通告仅作线索参考，建议优先使用官方直营渠道。',
    voteUp: 12,
    voteDown: 46,
    ratingSum: 38,
    ratingCount: 21,
  },
]

/**
 * 灌入默认 Token 白嫖通告（仅在表为空时调用）
 */
export function seedDefaultTokenDeals(db: Database.Database): void {
  const now = Date.now()

  const insert = db.prepare(`
    INSERT OR IGNORE INTO token_deals (
      id, user_id, provider, title, url, call_url, quota, models, region, quality,
      source_tag, expires_at, pinned, note, status, reject_reason,
      vote_up, vote_down, rating_sum, rating_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', '', ?, ?, ?, ?, ?, ?)
  `)

  const insertAll = db.transaction(() => {
    for (const d of DEFAULT_TOKEN_DEALS) {
      insert.run(
        newDealId(),
        1, // 归属 1 号管理员，作为官方示例内容
        d.provider,
        d.title,
        d.url,
        d.callUrl,
        d.quota,
        JSON.stringify(d.models),
        d.region,
        d.quality,
        d.sourceTag,
        d.expiresInDays === null ? null : now + d.expiresInDays * 86400000,
        d.pinned,
        d.note,
        d.voteUp,
        d.voteDown,
        d.ratingSum,
        d.ratingCount,
        now,
        now,
      )
    }
  })

  insertAll()
  console.log(`[DB] 已插入 ${DEFAULT_TOKEN_DEALS.length} 条默认 Token 白嫖通告`)
}
