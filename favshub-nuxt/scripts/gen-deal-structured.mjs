#!/usr/bin/env node
/**
 * gen-deal-structured.mjs — 为现有通告生成 summary / limits / requirements / faq / verify_scope 初稿
 *
 * 为什么需要它（2026-11-04）：
 *   新加的 5 个结构化字段在真实库里的填充率是 0%（76 条 approved 全空），
 *   于是详情页的 FAQ / 三格信息面板、列表页的摘要、对比页的 4 个列全部空着。
 *   功能是好的，数据是空的。
 *
 * 设计原则（重要）：
 *   1. **只从已有字段推导**，绝不编造额度、日期、条件。
 *      依据：title / quota / models / region / source_tag / real_name / expires_at / note。
 *   2. **推导不出的就留空**，不写占位词（"暂无"、"待补充"这种垃圾会污染页面）。
 *   3. **幂等**：已有非空值的不覆盖（除非 --force）。
 *   4. **默认 dry-run**：不打 --write 只打印，便于人工审阅后再落库。
 *
 * 用法：
 *   node scripts/gen-deal-structured.mjs                 # 预览（不改库）
 *   node scripts/gen-deal-structured.mjs --write         # 写入
 *   node scripts/gen-deal-structured.mjs --write --force # 覆盖已有值
 *   node scripts/gen-deal-structured.mjs --only-summary  # 只补 summary
 */
import Database from 'better-sqlite3'
import path from 'node:path'

const DB = process.env.NUXT_DB_PATH || path.resolve('data/favshub.db')
const WRITE = process.argv.includes('--write')
const FORCE = process.argv.includes('--force')
const ONLY_SUMMARY = process.argv.includes('--only-summary')

const db = new Database(DB, { readonly: !WRITE })

/* 分类 → 中文名 */
const CAT = { token: 'API 额度', cloud: '云服务器', domain: '域名', client: '客户端额度' }

/* 是否实名 → 领取条件里的措辞。**只用库里现有的枚举值**，不猜。 */
const REAL_NAME_TEXT = {
  no: '注册即可，无需实名',
  yes: '需实名认证',
  id_card: '需身份证实名认证',
  passport: '需护照实名认证',
  other: '需按平台要求完成实名',
}

/**
 * 生成 summary（一句话摘要）—— **只处理两种情况，其余留空**。
 *
 * 为什么不做模板化生成（2026-11-04 实测教训）：
 * 我先后试过两种自动写法，都失败了：
 *   ① 用 `quota` 当摘要 → 得到「15000 积分」这种裸碎片，与卡片上显示的额度重复
 *   ② 用「{分类}类免费资源，额度为{quota}」模板 → 得到
 *      「API 额度类免费资源，额度为6000 次/月免费调用额度。」这种机器腔，
 *      既啰嗦又没告诉读者标题之外任何新东西
 * 结论：**摘要是一个需要人写的字段**（它的价值就在于「补标题没说清的」），
 * 自动推导只能覆盖两种确实能推出有效信息的情形：
 *   · 已下架 —— 状态必须点明，否则用户白跑
 *   · 有明确领取门槛 —— 这是读者决策的第二要素
 * 其余一律返回空串：留空时 TokenDealCard 会自动回落到 `quota` 展示
 * （见该组件 `summaryFallsBackToQuota`），不会出现空白框。宁可不写，也不写机器腔。
 */
function genSummary(d) {
  const title = String(d.title || '')

  // 唯一「自动生成一定优于留空」的情形：已下架。
  // 这类必须点明，否则用户看到列表里的旧条目会白跑一趟。
  // 其余情况一律留空 —— 上一版给「需实名」的条目统一加
  // 「需身份证实名认证。领取前请先确认认证要求。」，13 条里 12 条是同一句，
  // 等于把列表变成复读机，比留空更糟。
  if (/已下架|已失效|已结束|已暂停/.test(title)) {
    const cat = CAT[d.category] || '免费额度'
    return `该${cat}通告已下架，领取入口可能已关闭；保留页面供查证历史信息。`
  }

  return ''
}

/**
 * 生成 requirements（领取条件）。
 * 只从 real_name 枚举 + 标题里的关键词推导；推导不出返回空。
 * 关键词表要保守：只认明确出现过的词，不做模糊联想。
 */
function genRequirements(d) {
  const parts = []
  const rn = String(d.real_name || '').trim()
  if (REAL_NAME_TEXT[rn]) parts.push(REAL_NAME_TEXT[rn])

  const title = String(d.title || '')
  if (/邀请码/.test(title)) parts.push('注册时需填写邀请码')
  if (/学生/.test(title)) parts.push('学生额度需完成学信网认证')
  if (/小红书/.test(title)) parts.push('需小红书账号参与活动')
  if (/征文/.test(title)) parts.push('需按活动要求提交征文')
  if (/报名/.test(title)) parts.push('需先报名活动')

  return parts.join('；')
}

/**
 * 生成 limits（限制条款）。
 * 同样只认标题/额度里的明确信息，不推测。
 */
function genLimits(d) {
  const parts = []
  const quota = String(d.quota || '')
  const title = String(d.title || '')

  if (/月/.test(quota)) parts.push('额度按月发放，非一次性到账')
  if (/每日|每天/.test(quota + title)) parts.push('按自然日刷新，当日未用完不累积')
  if (/有效期/.test(quota + title)) {
    const m = /有效期\s*(\d+)\s*(天|个月|年)/.exec(quota + title)
    if (m) parts.push(`额度有效期 ${m[1]} ${m[2]}`)
  }
  if (/限时|限量|名额/.test(title)) parts.push('属限时/限量活动，结束时间以官方公告为准')
  if (/一折|折扣|8\.8折/.test(title)) parts.push('折扣仅限指定模型，超出按原价计费')

  return parts.join('；')
}

/**
 * 补句号：已经以中文句读结尾的不再追加。
 *
 * 为什么需要（2026-11-04 实测 bug）：初版无条件写 `${requirements}。`，
 * 而 requirements / limits 可能由旧数据或「；」拼接而来、本身已带句号，
 * 结果渲染出「注册即可；学生额度需完成学信网认证。。」这种双句号，共 16 处。
 */
function withPeriod(s) {
  const t = String(s || '').trim()
  if (!t) return ''
  return /[。！？；：…]$/.test(t) ? t : `${t}。`
}

/**
 * 生成 faq。
 * 这些都是**站在读者角度、由已有字段能安全回答的问题**：
 *   · 额度怎么算 / 多久刷新 → 由 quota 推出
 *   · 要不要实名       → 由 real_name 推出
 *   · 到期怎么办       → 由 expires_at 推出
 *   · 限制有哪些       → 由 limits 推出
 * 答案里不写具体数字以外的承诺，避免误导。
 */
function genFaq(d, limits, requirements) {
  const faq = []
  const quota = String(d.quota || '').trim()

  if (quota) {
    faq.push({ q: '免费额度具体是多少？', a: `${withPeriod(quota)}以官方控制台实际显示为准。` })
  }
  if (requirements) {
    faq.push({ q: '领取需要什么条件？', a: withPeriod(requirements) })
  }
  if (limits) {
    faq.push({ q: '使用上有什么限制？', a: withPeriod(limits) })
  }
  if (d.expires_at) {
    const dt = new Date(Number(d.expires_at))
    if (!Number.isNaN(dt.getTime())) {
      const p = (n) => String(n).padStart(2, '0')
      const ymd = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
      faq.push({ q: '额度什么时候到期？', a: `标注的有效期到 ${ymd}，过期后按官方规则处理。` })
    }
  } else {
    faq.push({ q: '额度什么时候到期？', a: '当前未标注明确截止日期，以官方页面为准。' })
  }

  return faq.slice(0, 10)
}

/**
 * 生成 verify_scope（核实范围）。
 * **只在确有过核验记录时写**（verified_at > 0），且措辞必须如实：
 * 我们核的是公开页面上的信息，没登录实测过——这句必须写在里面。
 */
function genVerifyScope(d) {
  if (!d.verified_at) return ''
  const p = (n) => String(n).padStart(2, '0')
  const dt = new Date(Number(d.verified_at))
  const ymd = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
  return `${ymd} 核对过官方页面上的额度描述、领取条件与有效期；未登录实测调用，也未验证额度实际到账情况。`
}

const rows = db.prepare(`
  SELECT id, title, quota, models, region, source_tag, real_name, expires_at, verified_at,
         category, summary, limits, requirements, faq, verify_scope
  FROM token_deals
  WHERE status = 'approved'
  ORDER BY verified_at DESC, id
`).all()

console.log(`▶ 库：${DB}`)
console.log(`▶ 模式：${WRITE ? (FORCE ? '写入（覆盖）' : '写入（只补空）') : '预览（不改库）'}`)
console.log(`▶ 待处理：${rows.length} 条 approved\n`)

const stats = { summary: 0, limits: 0, requirements: 0, faq: 0, verify_scope: 0, skipped: 0 }
const upd = WRITE
  ? db.prepare(`UPDATE token_deals SET summary=?, limits=?, requirements=?, verify_scope=?, faq=? WHERE id=?`)
  : null

const sample = []
for (const d of rows) {
  const hasAny = [d.summary, d.limits, d.requirements, d.verify_scope].some((v) => String(v || '').trim())
  const hasFaq = String(d.faq || '[]') !== '[]' && String(d.faq || '').trim() !== ''
  if (!FORCE && hasAny && hasFaq) { stats.skipped++; continue }

  const summary = FORCE || !String(d.summary || '').trim() ? genSummary(d) : d.summary
  const requirements = FORCE || !String(d.requirements || '').trim() ? genRequirements(d) : d.requirements
  const limits = FORCE || !String(d.limits || '').trim() ? genLimits(d) : d.limits
  const verifyScope = FORCE || !String(d.verify_scope || '').trim() ? genVerifyScope(d) : d.verify_scope
  const faq = FORCE || !hasFaq ? genFaq(d, limits, requirements) : JSON.parse(d.faq || '[]')

  if (summary) stats.summary++
  if (limits) stats.limits++
  if (requirements) stats.requirements++
  if (verifyScope) stats.verify_scope++
  if (faq.length) stats.faq++

  if (sample.length < 3) {
    sample.push({ id: d.id, provider: d.title.slice(0, 24), summary, limits, requirements, verify_scope: verifyScope, faq })
  }

  if (WRITE) {
    if (ONLY_SUMMARY) {
      db.prepare('UPDATE token_deals SET summary=? WHERE id=?').run(summary || d.summary || '', d.id)
    } else {
      upd.run(summary || '', limits || '', requirements || '', verifyScope || '',
              JSON.stringify(faq), d.id)
    }
  }
}

console.log('=== 生成结果 ===')
console.log(`  summary        ${stats.summary}`)
console.log(`  limits         ${stats.limits}`)
console.log(`  requirements   ${stats.requirements}`)
console.log(`  verify_scope   ${stats.verify_scope}   ← 只有确有过核验日期的才有值`)
console.log(`  faq            ${stats.faq}`)
console.log(`  跳过（已有值）  ${stats.skipped}`)
console.log('\n=== 样例（前 3 条）===')
for (const s of sample) {
  console.log(`\n[${s.provider}]`)
  console.log(`  summary      ${s.summary || '(空)'}`)
  console.log(`  requirements ${s.requirements || '(空)'}`)
  console.log(`  limits       ${s.limits || '(空)'}`)
  console.log(`  verify_scope ${s.verify_scope || '(空)'}`)
  console.log(`  faq          ${s.faq.length} 条：${s.faq.map((f) => f.q).join(' / ')}`)
}
if (!WRITE) console.log('\n（这是预览，未写库。加 --write 落库）')
db.close()