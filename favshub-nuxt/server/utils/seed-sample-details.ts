/**
 * 种子通告的「示例明细」生成器
 *
 * ## 为什么需要
 *
 * `seed-token-deals.ts` 早期只灌了**演示用缓存计数**（`vote_up` / `rating_count` …），
 * 却没有对应的明细行。后果：
 * 1. 页面显示「64 人评测」，点进去却是「还没有人评测」—— 自相矛盾；
 * 2. 任何一次真实投票触发 `syncDealCounters` 重算 → 演示数字**塌成真实值**；
 * 3. 依赖「评测条目」的 UI（如打标按钮，挂在 `li.review-item` 内）因无宿主而不渲染，
 *    极易被误判为「功能没上线」。
 *
 * 本模块让**明细成为唯一真源**：种子通告建好后立刻灌入示例评测与示例投票，
 * 再由 `syncDealCounters` 从明细聚合出计数。新部署实例从第一天起就自洽。
 *
 * ## 设计要点
 *
 * - **确定性**：随机源由 `sha256(dealId)` 派生 → 同一通告每次生成结果一致，可重放、可测试。
 * - **可识别可清理**：`fingerprint` 带 `seed:` 前缀，便于日后批量清除或甄别。
 * - **幂等**：`INSERT OR IGNORE` + 每条独立指纹，重复执行不会叠加。
 * - **内容与星级语义匹配**：5 档内容池按星级分派，避免「5 星吐槽」这类违和。
 */
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

/** 单条通告的示例规模 */
export interface SampleScale {
  /** 评测条数区间 [min, max] */
  reviews: [number, number]
  /** 「还能用」票数区间 [min, max] */
  upVotes: [number, number]
  /** 「已失效」票数占 up 的比例区间 */
  downRatio: [number, number]
}

/** 默认规模：中等——既显热闹，又不至于生成海量文本 */
export const DEFAULT_SAMPLE_SCALE: SampleScale = {
  reviews: [15, 25],
  upVotes: [60, 80],
  downRatio: [0.05, 0.15],
}

/** 星级分布权重（白嫖通告整体偏正面，均值约 4.4） */
const RATING_WEIGHTS: Array<[number, number]> = [
  [5, 55],
  [4, 30],
  [3, 10],
  [2, 3],
  [1, 2],
]

/** 昵称池（同通告内不重复取用） */
const NICKNAMES: string[] = [
  '老王的工具箱', '折腾不止', '白嫖使我快乐', '孤帆远影', '南山有木',
  '代码搬运工', '半夜不睡', '一只小菜鸟', '山高水长', '风过留痕',
  '轻舟已过', '半盏清茶', '巷口阿飞', '数据苦工', '云上漫步',
  '十点半睡', '小满', '路边社', '编译中', '落地成盒',
  '陈皮糖', '长夜漫漫', '追风少年', '阿蒙', '望山跑马',
  '断点续传', '大鹏展翅', '甜酒酿', '岩井', '月半弯',
]

/** 分星级内容池 —— 文案与星级语义一致 */
const CONTENT: Record<number, string[]> = {
  5: [
    '注册流程很顺，额度到账也快，接口直接兼容 OpenAI 格式，改个 base_url 就通了。',
    '额度给得实在，日常写点小工具完全够用，延迟也在可接受范围。',
    '文档写得清楚，示例代码能直接跑，省了我不少时间。',
    '用了快两周，稳定性不错，没遇到掉线或者限流的情况。',
    '新用户福利确实大，白嫖期间体验下来质量超出预期。',
    '模型选择挺多，切换起来方便，适合多场景试水。',
    '客服响应快，额度问题当天就解决了。',
    '免费额度够跑完整个项目验证，性价比满分。',
    '接口很稳，并发稍微高一点也没报错。',
    '注册即送，没有套路，验证手机号就能开始用。',
  ],
  4: [
    '整体挺好用的，就是高峰期偶尔要等一下，其他没毛病。',
    '额度到账略慢，等了十几分钟，用起来倒是很稳。',
    '接口兼容性不错，就是文档有个别地方没更新。',
    '性能够用，复杂长文本处理时速度会慢一点。',
    '体验不错，希望后续能加更多模型。',
    '免费额度给得大方，就是调用频率限制稍微紧了些。',
    '注册简单，用下来稳定，扣一分给偶发的超时。',
    '比预期的好，拿来做原型验证很合适。',
    '功能齐全，就是控制台界面用起来不太顺手。',
    '速度可以，偶有波动但不影响使用。',
  ],
  3: [
    '中规中矩吧，额度确实是送的，但限流比想象中严。',
    '能用，就是高峰时段明显变慢，急用的话不太合适。',
    '额度给得不多，跑几个测试就见底了。',
    '接口是老格式，得自己适配一下，稍微费点事。',
    '注册流程有点绕，要过好几步验证。',
    '免费的部分够尝鲜，深入用就得掏钱了。',
    '稳定性一般，偶尔会返回错误，重试一下能过。',
    '文档比较简略，很多参数得自己摸索。',
  ],
  2: [
    '限流太狠了，稍微密集一点调用就直接拒绝。',
    '额度到账拖了很久，客服也没给明确答复。',
    '接口经常超时，做正式项目不太敢用。',
    '注册门槛不低，实际能拿到的额度比宣传的少。',
  ],
  1: [
    '说是送额度，结果各种限制，基本等于没有。',
    '用了两天就频繁报错，体验很差。',
    '宣传和实际差距太大，不推荐。',
  ],
}

/** mulberry32 —— 轻量确定性 PRNG，由 32 位种子驱动 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 由 dealId 派生确定性随机源 */
function rngFor(dealId: string): () => number {
  const h = createHash('sha256').update(dealId).digest()
  return mulberry32(h.readUInt32BE(0))
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

function pickRating(rng: () => number): number {
  const total = RATING_WEIGHTS.reduce((s, [, w]) => s + w, 0)
  let x = rng() * total
  for (const [star, w] of RATING_WEIGHTS) {
    x -= w
    if (x < 0) return star
  }
  return 5
}

/** Fisher–Yates 洗牌（确定性） */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface SampleDetailCounts {
  reviews: number
  upVotes: number
  downVotes: number
}

/**
 * 为一条种子通告灌入示例评测 + 示例投票。
 *
 * 调用前 `token_deals` 行必须已存在（本函数只写明细表，不动主表计数；
 * 主表计数请随后用 `syncDealCounters` 从明细聚合）。
 *
 * 表未迁移时静默跳过，不阻断种子流程。
 */
export function seedSampleDetails(
  db: Database.Database,
  dealId: string,
  scale: SampleScale = DEFAULT_SAMPLE_SCALE,
): SampleDetailCounts {
  const rng = rngFor(dealId)
  const now = Date.now()

  const nReviews = randInt(rng, scale.reviews[0], scale.reviews[1])
  const nUp = randInt(rng, scale.upVotes[0], scale.upVotes[1])
  const ratio = scale.downRatio[0] + rng() * (scale.downRatio[1] - scale.downRatio[0])
  const nDown = Math.max(1, Math.round(nUp * ratio))

  let inserted = { reviews: 0, upVotes: 0, downVotes: 0 }

  try {
    const insertReview = db.prepare(`
      INSERT OR IGNORE INTO token_deal_guest_reviews (
        id, deal_id, user_id, nickname, qq_cipher, rating, content,
        status, reject_reason, reviewer_id, ip_hash, fingerprint, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, '', ?, ?, 'approved', '', NULL, '', ?, ?, ?)
    `)
    const insertVote = db.prepare(`
      INSERT OR IGNORE INTO token_deal_guest_votes (
        deal_id, fingerprint, ip_hash, vote, created_at, updated_at
      ) VALUES (?, ?, '', ?, ?, ?)
    `)

    const run = db.transaction(() => {
      // 昵称池打乱后顺序取用 → 同通告内昵称唯一；超出池容量则加序号后缀
      const nicks = shuffle(NICKNAMES, rng)
      for (let i = 0; i < nReviews; i++) {
        const star = pickRating(rng)
        const pool = CONTENT[star]
        const content = pool[Math.floor(rng() * pool.length)]
        const base = nicks[i % nicks.length]
        const nickname = i < nicks.length ? base : `${base}${Math.floor(i / nicks.length) + 1}`
        // 时间散落在最近 45 天内，让列表排序看起来自然
        const ts = now - randInt(rng, 1, 45) * 86400000
        insertReview.run(
          `gr_seed_${dealId}_${i}`,
          dealId,
          nickname,
          star,
          content,
          `seed:rv:${dealId}:${i}`,
          ts,
          ts,
        )
        inserted.reviews++
      }

      for (let i = 0; i < nUp; i++) {
        insertVote.run(dealId, `seed:vt:${dealId}:u${i}`, 'up', now, now)
        inserted.upVotes++
      }
      for (let i = 0; i < nDown; i++) {
        insertVote.run(dealId, `seed:vt:${dealId}:d${i}`, 'down', now, now)
        inserted.downVotes++
      }
    })

    run()
  } catch (err: any) {
    // 表未迁移（如极早期的库）时跳过示例明细，不影响通告本身可用
    console.warn(`[DB] 种子通告示例明细写入跳过 (${dealId}): ${err?.message || err}`)
    return { reviews: 0, upVotes: 0, downVotes: 0 }
  }

  return inserted
}
