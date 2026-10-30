// 4项需求真机端到端验收脚本
const BASE = process.argv[2] || 'http://127.0.0.1:3215'

let pass = 0
let fail = 0
const failures = []

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* HTML */ }
  return { status: res.status, text, json, headers: res.headers }
}

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log('  [PASS]', name)
  } else {
    fail++
    failures.push(name + (detail ? ' — ' + detail : ''))
    console.log('  [FAIL]', name, detail)
  }
}

async function run() {
  console.log(`=== 开始全栈 HTTP 端到端验收 (${BASE}) ===\n`)

  // 1. 验证友情链接接口
  console.log('▶ 1. 友情链接接口验证')
  const flRes = await req('/api/friend-links')
  check('GET /api/friend-links 返回 200', flRes.status === 200)
  check('返回包含 data 数组', flRes.json && Array.isArray(flRes.json.data))
  check('自动灌入默认种子友情链接', flRes.json && flRes.json.data.length >= 1, `条数: ${flRes.json?.data?.length}`)
  if (flRes.json?.data?.length > 0) {
    const first = flRes.json.data[0]
    check('友链条目包含必要字段 name, url', !!first.name && !!first.url, JSON.stringify(first))
  }

  // 2. 验证公告接口
  console.log('\n▶ 2. 前端公告接口验证')
  const annRes = await req('/api/announcements')
  check('GET /api/announcements 返回 200', annRes.status === 200)
  check('公告返回包含 data 数组', annRes.json && Array.isArray(annRes.json.data))
  check('自动灌入默认种子公告', annRes.json && annRes.json.data.length >= 1, `条数: ${annRes.json?.data?.length}`)
  let firstAnnId = null
  if (annRes.json?.data?.length > 0) {
    const first = annRes.json.data[0]
    firstAnnId = first.id
    check('公告条目包含必要字段 title, content, pinned', !!first.title && !!first.content && first.pinned !== undefined)
  }

  if (firstAnnId) {
    const annDetail = await req(`/api/announcements/${firstAnnId}`)
    check(`GET /api/announcements/${firstAnnId} 获取详情返回 200`, annDetail.status === 200)
    check('详情包含富文本正文', !!annDetail.json?.data?.content)
  }

  // 3. 验证页面 SSR HTML 渲染
  console.log('\n▶ 3. 页面渲染与组件注入验证')
  const tokensPage = await req('/tokens')
  check('GET /tokens 返回 200', tokensPage.status === 200)
  check('页面 HTML 中包含统一页脚 SiteFooter 结构', tokensPage.text.includes('site-footer') || tokensPage.text.includes('友情链接'))
  check('页面 HTML 中包含前端公告悬浮挂件 SiteAnnouncement 结构', tokensPage.text.includes('announcement-widget') || tokensPage.text.includes('announcement-fab'))

  const homePage = await req('/')
  check('GET / 首页返回 200', homePage.status === 200)
  check('首页 HTML 中包含统一页脚 SiteFooter', homePage.text.includes('site-footer') || homePage.text.includes('友情链接'))

  // 4. 验证分类【客户端额度】
  console.log('\n▶ 4. 通告分类【客户端额度】筛选测试')
  const categoryFilter = await req('/api/token-deals?category=client')
  check('GET /api/token-deals?category=client 接受客户端额度参数并返回 200', categoryFilter.status === 200)

  console.log('\n=============================================')
  console.log(`验收结果: ${pass} 项通过, ${fail} 项失败`)
  console.log('=============================================')

  if (fail > 0) {
    console.error('失败明细:\n', failures.join('\n'))
    process.exit(1)
  } else {
    process.exit(0)
  }
}

run().catch((err) => {
  console.error('验收执行异常:', err)
  process.exit(1)
})
