/**
 * 为 domain 分类补齐可审字段（一次性数据处理，2026-11-04）
 *
 * 背景：13 条免费域名渠道从对标站点导入后停在 pending，缺
 * requirements / verify_scope / faq / expires_at 四类字段，
 * 后台审核时看不出「怎么领、核实到什么程度」。
 *
 * 原则（与 gen-deal-structured.mjs 一致）：
 *   只从**本条记录已有的事实**推导，不从模板套话生成。
 *   summary / limits 里没写到的东西，宁可留空 —— 空字段在 UI 上是不渲染，
 *   而编造的内容会被用户当成核实过的事实。
 *
 * 用法：
 *   node scripts/gen-domain-fields.mjs            # 预览
 *   node scripts/gen-domain-fields.mjs --write    # 写入
 */
import Database from 'better-sqlite3'
import { resolve } from 'node:path'

const DB = process.env.NUXT_DB_PATH
  || resolve(process.cwd(), 'data/favshub.db')
const WRITE = process.argv.includes('--write')

const db = new Database(DB)

/** 抓取文本里第一个匹配的片段，用于「从已有文案里取事实」而非凭空造。 */
function pick(text, patterns) {
  if (!text) return ''
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return m[0]
  }
  return ''
}

/**
 * 领取条件的判定规则表。
 *
 * 每条规则只在**文案里确实出现该线索**时才生效，
 * 并原样引用触发它的那句话，避免生成「需实名认证」这类通用废话。
 */
const REQUIREMENT_RULES = [
  { re: /邀请码|invite|邀请注册/i, text: '需使用邀请码 / 邀请链接注册' },
  { re: /GitHub[^。；]{0,20}PR|提\s*PR|提交\s*PR/i, text: '需会用 GitHub 提 PR 并按要求写配置文件' },
  { re: /人工审核|志愿者|审核通过/i, text: '需人工审核，等待时间不定' },
  { re: /邮箱验证|邮箱验证码/i, text: '需邮箱验证（收验证码开通）' },
  { re: /实名|身份认证/i, text: '需实名认证' },
  { re: /优惠码|CODEHOST|折扣码/i, text: '需在下单时填优惠码' },
  { re: /学生身份认证|需学生证|凭学生证/, text: '需学生身份' },
  { re: /Discord/i, text: '需 Discord 账号登录' },
  { re: /名额|限量|截止/i, text: '有名额 / 时间限制，先到先得' },
]

/** 从 summary + limits 合成 requirements。去重后按出现顺序拼。 */
function genRequirements(row) {
  const text = `${row.summary || ''} ${row.limits || ''}`
  const hits = []
  for (const r of REQUIREMENT_RULES) {
    if (r.re.test(text) && !hits.includes(r.text)) hits.push(r.text)
  }
  return hits.join('；')
}

/**
 * verify_scope：说明「我们核到什么程度」。
 *
 * 域名类的核实天然只能到「页面存在 + 政策文案」这一层 ——
 * 真正注册一遍才能验证发不发、解析通不通，成本太高。
 * 所以统一如实写明核实边界，而不是写「已核实可用」这种过度背书。
 */
function genVerifyScope(row) {
  if (!row.summary && !row.limits) return ''
  const parts = []
  parts.push('已核对官方页面与活动文案')
  if (/名额|限量|截止/.test(`${row.summary} ${row.limits}`)) {
    parts.push('名额与时点以官方页面实时显示为准')
  }
  if (/后缀|子域名|二级域/.test(`${row.summary} ${row.limits}`)) {
    parts.push('未实际注册，可用后缀与解析能力未逐一验证')
  }
  return parts.join('；')
}

/**
 * 判断这条渠道给的是「二级/子域名」还是「可独立解析的域名」。
 *
 * 先看否定线索：文案里只要出现「二级域名 / 子域名 / 挂在…下的」，
 * 就按子域名处理 —— 即使同一段里也写了「独立解析」。
 * 因为域名文案里「能独立解析」常用来描述记录可控，不代表拿到了独立顶级域。
 */
function isSubdomain(row) {
  const text = `${row.summary || ''} ${row.limits || ''}`
  if (/二级域名|子域名|挂在.{0,12}下的|非独立/.test(text)) return true
  if (/顶级域|真顶级域|独立注册域|独立域名/.test(text)) return false
  return true // 判不了时保守按子域名写，避免over-claim
}

/**
 * 从 summary 里取第一句**陈述句**。
 *
 * 两个坑都踩过：
 * ① 按字符数截（/[^。；]{10,80}[。；]/）会从句子中间切进去，
 *    产出「商 CodeHost 联合…」「names.io 挂在…」这种丢了开头半截的答案。
 * ② 直接取第一句，遇到 DuckDNS 这种「家里宽带 IP 会变、想用域名稳定指向
 *    自建服务？」的**引子式反问**，答案就变成了一个问句。
 * 所以：按句切成句子后，跳过疑问句，取第一个陈述句。
 */
function firstSentence(text) {
  if (!text) return ''
  const sentences = String(text).trim().split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean)
  for (const s of sentences) {
    // 以问号结尾、或含明显反问语气的句子跳过
    if (/[？?]$/.test(s)) continue
    if (/想用|是不是|要不要/.test(s)) continue
    return s
  }
  return ''
}

/** FAQ：问题固定为域名类最常问的四个，答案引用本条已有事实。 */
function genFaq(row) {
  const list = []
  const name = row.provider || '该服务'

  if (row.quota || row.summary) {
    list.push({
      q: '能领到什么？',
      a: ensurePeriod(firstSentence(row.summary) || row.quota || ''),
    })
  }
  list.push({
    q: '是独立域名还是二级域名？',
    // 判定顺序很重要：先查「二级/子域名」这类否定线索。
    // 原先只查 /顶级域|独立解析/，CF Pro 的文案里同时出现
    // 「二级域名」和「独立解析」，结果被判成独立域名 —— 结论正好相反。
    a: isSubdomain(row)
      ? `${name} 给的是挂在服务方主域下的子域名，主域控制权在服务方手上。`
      : `${name} 给的是可独立解析的域名，不是挂在别人域名下的二级域名。`,
  })
  list.push({
    q: '免费域名会突然失效吗？',
    a: '存在这个风险。免费域名依赖运营方政策，活动结束、滥用回收或后缀政策调整都可能发生；做重要业务建议自备一个付费域名兜底。',
  })
  if (row.requirements) {
    list.push({
      q: '领取需要什么条件？',
      a: ensurePeriod(row.requirements),
    })
  }
  // 过滤空答案，避免出现「问题有了答案却是空」
  return list.filter((x) => x.a && x.a.trim())
}

/** 已是句末标点就不再补，防止出现「。。」 */
function ensurePeriod(s) {
  if (!s) return ''
  const t = String(s).trim()
  return /[。！？；：…]$/.test(t) ? t : t + '。'
}

const rows = db
  .prepare("SELECT * FROM token_deals WHERE category = 'domain' ORDER BY provider")
  .all()

if (!rows.length) {
  console.log('没有 domain 记录，退出')
  process.exit(0)
}

console.log(`▶ 库：${DB}`)
console.log(`▶ 模式：${WRITE ? '写入' : '预览（不改库）'}`)
console.log(`▶ domain 记录：${rows.length} 条\n`)

const updates = []
for (const row of rows) {
  const next = {}
  // 只填空字段，不覆盖已有内容 —— 已有值是上一轮人工/脚本的成果
  if (!row.requirements) {
    const v = genRequirements(row)
    if (v) next.requirements = v
  }
  if (!row.verify_scope) {
    const v = genVerifyScope(row)
    if (v) next.verify_scope = v
  }
  if (!row.faq || row.faq === '[]') {
    const v = genFaq(row)
    if (v.length) next.faq = JSON.stringify(v)
  }
  if (!row.expires_at) {
    // 只在文案里**明确写了日期**时才落有效期，否则留空（留空 UI 显示「长期有效 / 未标注」）
    const m = `${row.summary || ''} ${row.limits || ''}`.match(/20\d{2}-\d{2}-\d{2}|20\d{2}\s*年\s*\d{1,2}\s*月/)
    if (m) {
      const d = m[0].replace(/年|月/g, (c) => (c === '年' ? '-' : ''))
      const t = Date.parse(d)
      // 单位是**毫秒**，与表内既有数据一致（实测 13 位，如 1796054399000 = 2026-11-30）。
      // 早先这里写了 Math.floor(t / 1000) 存秒，结果 UI 按毫秒解释成 1970-01-22，
      // CF Pro / CodeHost 因此被判「已过期」而退出审核队列 —— 这个 bug 已在生产库修正。
      if (!Number.isNaN(t)) next.expires_at = t
    }
  }
  if (Object.keys(next).length) updates.push({ row, next })
}

console.log('=== 将补全 ===')
for (const { row, next } of updates) {
  console.log(`\n[${row.provider}]  补：${Object.keys(next).join(', ')}`)
  if (next.requirements) console.log(`  requirements : ${next.requirements}`)
  if (next.verify_scope) console.log(`  verify_scope : ${next.verify_scope}`)
  if (next.faq) {
    const arr = JSON.parse(next.faq)
    console.log(`  faq          : ${arr.length} 条`)
    arr.forEach((f) => console.log(`     Q ${f.q}\n     A ${f.a}`))
  }
  if (next.expires_at) console.log(`  expires_at   : ${new Date(next.expires_at * 1000).toISOString().slice(0, 10)}`)
}

console.log(`\n=== 汇总 ===\n  补齐 ${updates.length} 条 / 共 ${rows.length} 条`)

if (WRITE && updates.length) {
  const now = Math.floor(Date.now() / 1000)
  const stmt = db.prepare(
    'UPDATE token_deals SET requirements = COALESCE(NULLIF(?, \'\'), requirements), '
    + 'verify_scope = COALESCE(NULLIF(?, \'\'), verify_scope), '
    + 'faq = COALESCE(NULLIF(?, \'\'), faq), '
    + 'expires_at = COALESCE(?, expires_at), updated_at = ? WHERE id = ?',
  )
  const tx = db.transaction((items) => {
    for (const { row, next } of items) {
      stmt.run(next.requirements || '', next.verify_scope || '', next.faq || '', next.expires_at || null, now, row.id)
    }
  })
  tx(updates)
  console.log(`  ✓ 已写入 ${updates.length} 条`)
} else if (!WRITE) {
  console.log('  （预览模式，未写入；加 --write 生效）')
}

db.close()