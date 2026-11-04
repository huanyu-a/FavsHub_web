#!/usr/bin/env node
/**
 * verify-admin-flow.mjs — 管理员链路端到端验证（R1）
 *
 * 为什么要有这个脚本（2026-11-04）：
 *   白嫖板块这一批改动里，`featured` 仅管理员可写、`source_url` 永不下发、
 *   PUT 是全量替换、提案通道能改 category —— 这四条都只在静态分析或代码阅读层面
 *   被确认过，**没有一条在真实 HTTP 链路上跑过**。
 *   而它们恰好都是「权限/数据完整性」相关，出错不会报错、只会静默写错。
 *
 * 用法：
 *   node scripts/verify-admin-flow.mjs <baseUrl> [dbPath]
 *   例：node scripts/verify-admin-flow.mjs http://127.0.0.1:3311 /tmp/test.db
 *
 * 前提：
 *   1. 目标实例连的是**库副本**（脚本会写数据；dbPath 用于直查落库结果）；
 *   2. 库里存在两个可登录账号：`vr_admin`(is_admin=1) 与 `vr_user`(is_admin=0)，
 *      密码均为 `verify-pass-123`（见 docs/audits/2026-11-04-ship-readiness.md 的准备步骤）。
 *
 * 退出码：全部 PASS → 0；任一 FAIL → 1。
 */
import Database from 'better-sqlite3'

const BASE = (process.argv[2] || 'http://127.0.0.1:3311').replace(/\/+$/, '')
const DB_PATH = process.argv[3] || ''
const PW = 'verify-pass-123'

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const check = (cond, m) => cond ? ok(m) : bad(m)

/** 带 cookie 的请求（登录后 JWT 走 httpOnly cookie，不返回 body） */
function makeClient() {
  let cookie = ''
  return {
    async req(path, { method = 'GET', body } = {}) {
      const headers = {}
      if (cookie) headers.cookie = cookie
      if (body !== undefined) headers['content-type'] = 'application/json'
      const res = await fetch(BASE + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      })
      const sc = res.headers.getSetCookie?.() || []
      for (const c of sc) {
        const kv = c.split(';')[0]
        if (kv.startsWith('favshub_token=')) cookie = kv
      }
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch {}
      return { status: res.status, json, text }
    },
  }
}

async function login(username) {
  const c = makeClient()
  const r = await c.req('/api/auth/login', { method: 'POST', body: { username, password: PW } })
  if (r.status !== 200) throw new Error(`登录 ${username} 失败 HTTP ${r.status}: ${r.text.slice(0, 200)}`)
  return c
}

const dbQuery = (sql, ...args) => {
  if (!DB_PATH) return null
  const db = new Database(DB_PATH, { readonly: true })
  try { return db.prepare(sql).get(...args) } finally { db.close() }
}

async function main() {
  console.log(`▶ 目标：${BASE}`)
  if (!DB_PATH) console.log('  ⚠ 未传 dbPath，落库断言将跳过（只验 HTTP 层）')

  console.log('\n▶ 1. 登录')
  const admin = await login('vr_admin')
  const user = await login('vr_user')
  ok('管理员与普通用户均登录成功')

  // ── 2. 管理员创建带全部新字段的通告 ──
  console.log('\n▶ 2. 管理员创建：新字段落库 + 服务端渲染')
  const payload = {
    provider: 'VR验证服务商', title: 'VR验证：全字段通告', url: 'https://example.com/vr-deal',
    category: 'token',
    summary: '一句话摘要（VR）',
    limits: '限制段落（VR）：**加粗**；\n\n- 条目一\n- 条目二',
    requirements: '领取条件（VR）',
    verify_scope: '核实范围（VR）',
    faq: [{ q: 'VR问1', a: 'VR答1' }, { q: 'VR问2', a: 'VR答2' }],
  }
  const created = await admin.req('/api/token-deals', { method: 'POST', body: payload })
  const id = created.json?.deal_id || created.json?.id || created.json?.deal?.id
  check(!!id, `创建成功（id=${id}）`)
  if (!id) return

  const d = (await admin.req(`/api/token-deals/${id}`)).json
  const deal = d.deal || d
  check(deal.summary === payload.summary, 'summary 回读一致')
  check(deal.limits === payload.limits, 'limits 回读一致')
  check(deal.requirements === payload.requirements, 'requirements 回读一致')
  check(deal.verify_scope === payload.verify_scope, 'verify_scope 回读一致')
  check(Array.isArray(deal.faq) && deal.faq.length === 2, `faq 是 2 条数组（实际 ${deal.faq?.length}）`)
  check(typeof deal.limits_html === 'string' && deal.limits_html.includes('<strong>'),
    'limits_html 由服务端渲染（含 <strong>，证明走了 marked）')
  check(!('source_url' in deal), 'source_url 不下发（任何身份）')

  // ── 3. featured 权限 ──
  console.log('\n▶ 3. featured 仅管理员可写')
  const fd = await admin.req(`/api/token-deals/${id}`, { method: 'PUT', body: { ...payload, featured: 1 } })
  check(fd.status === 200, `管理员 PUT featured=1 → HTTP ${fd.status}`)
  const featList = (await admin.req('/api/token-deals?featured=1&limit=50')).json
  const hit = (featList.deals || featList.token_deals || []).some((x) => x.id === id)
  check(hit, '?featured=1 能命中该条')

  // 普通用户改自己的通告、传 featured=1 → 应被静默忽略
  const own = await user.req('/api/token-deals', {
    method: 'POST',
    body: { provider: 'VR普通用户', title: 'VR用户自己的通告', url: 'https://example.com/vr-own',
            category: 'token', summary: 'own', faq: [{ q: 'q', a: 'a' }], featured: 1 },
  })
  const ownId = own.json?.deal_id || own.json?.id
  check(!!ownId, `普通用户创建自己的通告（id=${ownId}）`)
  if (ownId) {
    if (DB_PATH) {
      const row = dbQuery('SELECT featured FROM token_deals WHERE id=?', ownId)
      check(row?.featured === 0, `普通用户创建时 featured 被忽略（DB featured=${row?.featured}）`)
    }
    await user.req(`/api/token-deals/${ownId}`, {
      method: 'PUT',
      body: { provider: 'VR普通用户', title: 'VR用户自己的通告', url: 'https://example.com/vr-own',
              category: 'token', faq: [{ q: 'q', a: 'a' }], featured: 1 },
    })
    if (DB_PATH) {
      const row = dbQuery('SELECT featured FROM token_deals WHERE id=?', ownId)
      check(row?.featured === 0, `普通用户 PUT 传 featured=1 被忽略（DB featured=${row?.featured}）`)
    }
  }

  // ── 4. PUT 全量替换语义（必须证实，不能假设）──
  console.log('\n▶ 4. PUT 是全量替换（漏传字段会被清空）')
  if (ownId) {
    await user.req(`/api/token-deals/${ownId}`, {
      method: 'PUT',
      body: { provider: 'VR普通用户', title: 'VR带全字段', url: 'https://example.com/vr-own',
              category: 'token', summary: 'S', limits: 'L', requirements: 'R', verify_scope: 'V',
              faq: [{ q: 'q1', a: 'a1' }, { q: 'q2', a: 'a2' }] },
    })
    const before = DB_PATH ? dbQuery('SELECT summary, faq FROM token_deals WHERE id=?', ownId) : null
    if (before) check(before.summary === 'S' && before.faq.includes('q1'), '全字段写入成功')

    // 只改 title，其余一概不传
    await user.req(`/api/token-deals/${ownId}`, {
      method: 'PUT',
      body: { provider: 'VR普通用户', title: 'VR只改标题', url: 'https://example.com/vr-own', category: 'token' },
    })
    if (DB_PATH) {
      const after = dbQuery('SELECT title, summary, faq FROM token_deals WHERE id=?', ownId)
      check(after.title === 'VR只改标题', 'title 已更新')
      check(after.summary === '', `summary 被清空（全量替换语义已证实，值="${after.summary}"）`)
      check(after.faq === '[]' || after.faq === '', `faq 被清空（值="${after.faq}"）`)
      console.log('    ↳ 结论：UI 编辑器总是发全字段，故无风险；但脚本/第三方调用方必须发全量。')
    }
  }

  // ── 5. 提案通道能改 category（W1 修的既有缺陷）──
  console.log('\n▶ 5. 提案通道改 category → 批准后落库')
  if (ownId && DB_PATH) {
    // 先让条目可见（提案要求可读），再提交建议
    await admin.req(`/api/token-deal-edits/__none__/review`, { method: 'POST', body: { action: 'reject' } }).catch(() => {})
    const db = new Database(DB_PATH)
    db.prepare(`UPDATE token_deals SET status='approved' WHERE id=?`).run(ownId)
    db.close()

    const prop = await user.req(`/api/token-deals/${ownId}/edits`, {
      method: 'POST', body: { category: 'cloud', comment: 'VR：建议改分类' },
    })
    const editId = prop.json?.edit?.id
    check(!!editId, `建议已提交（id=${editId}）`)
    if (editId) {
      const rev = await admin.req(`/api/token-deal-edits/${editId}/review`, {
        method: 'POST', body: { action: 'approve' },
      })
      check(rev.status === 200, `批准 HTTP ${rev.status}`)
      const row = dbQuery('SELECT category FROM token_deals WHERE id=?', ownId)
      check(row?.category === 'cloud', `主表 category 已变为 cloud（实际=${row?.category}）`)
    }
  }

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\n脚本异常:', e.message); process.exit(1) })