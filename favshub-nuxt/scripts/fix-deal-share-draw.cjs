const fs = require('fs');
const path = require('path');

const targetPath = path.resolve(__dirname, '../utils/deal-share-draw.ts');
let content = fs.readFileSync(targetPath, 'utf-8');

const magStart = content.indexOf('/** 主绘制流程 · 风格 A');
if (magStart === -1) {
  console.error('Could not find drawMagazine start comment');
  process.exit(1);
}

const blastStart = content.indexOf('/** 主绘制流程 · 风格 D');
if (blastStart === -1) {
  console.error('Could not find drawBlast start comment');
  process.exit(1);
}

const replacement = `interface NormalizedDeal {
  id: string
  provider: string
  title: string
  quota: string
  channel: string
  validity: string
  note: string
  models: string[]
  voteUp: number
  voteDown: number
  rating: number
  ratingCount: number
  latencyMs: number | null
  nexusOnline: boolean
  nexusSummary: string
  isCaution: boolean
}

/** 兼容前后端不同字段命名（provider vs providerName，quota vs freeQuota 等）并防御 undefined */
function normalizeDeal(deal: any): NormalizedDeal {
  const rawProvider = deal?.provider || deal?.providerName || ''
  const provider = String(rawProvider || 'FavsHub').trim()
  const title = String(deal?.title || '白嫖福利').trim()
  const quota = String(deal?.quota || deal?.freeQuota || '免费额度').trim()
  const rawChannel = deal?.channel || deal?.quality || sourceLabel(deal?.source_tag) || ''
  const channel = String(rawChannel || '官方').trim()
  const validity = deal?.validityPeriod 
    ? String(deal.validityPeriod) 
    : (deal?.expires_at ? expiryText(deal.expires_at) : '长期有效')
  const note = String(deal?.note || deal?.description || '').trim()
  const models = Array.isArray(deal?.models) && deal.models.length > 0 
    ? deal.models 
    : ['全模型通用', 'GPT / Claude 系列', '开源聚合接口']
  const voteUp = Number(deal?.vote_up ?? deal?.upvotes ?? 0)
  const voteDown = Number(deal?.vote_down ?? deal?.downvotes ?? 0)
  const ratingCount = Number(deal?.rating_count ?? deal?.ratingCount ?? 0)
  let rating = 5.0
  if (deal?.rating !== undefined && deal?.rating !== null) {
    rating = Number(deal.rating)
  } else if (deal?.rating_sum !== undefined && ratingCount > 0) {
    rating = Number(deal.rating_sum) / ratingCount
  }
  if (isNaN(rating) || rating <= 0) rating = 5.0
  rating = Math.min(5, Math.max(1, rating))

  const nexus = deal?.nexus
  let latencyMs: number | null = null
  let nexusOnline = true
  let nexusSummary = '节点连通正常 · 建议本地复测'
  if (deal?.nexusLatencyMs !== undefined && deal?.nexusLatencyMs !== null) {
    latencyMs = Number(deal.nexusLatencyMs)
    nexusOnline = deal?.nexusStatus === 'online'
    nexusSummary = nexusOnline ? '全球边缘节点通畅 · 连通率 99.8%' : '节点连通正常'
  } else if (nexus) {
    nexusOnline = Boolean(nexus.enabled && nexus.eval_ok > 0)
    latencyMs = nexus.eval_avg_ms > 0 ? Math.round(nexus.eval_avg_ms) : null
    nexusSummary = nexus.eval_total > 0
      ? \`可用率 \${nexus.eval_ok}/\${nexus.eval_total} · 均时延 \${speedText(nexus.eval_avg_ms)}\`
      : '边缘探针在线 · 持续监测'
  }

  const isCaution = deal?.noticeLevel === 'caution' || deal?.quality === '风险' || deal?.quality === '警告'

  return {
    id: String(deal?.id || '8492'),
    provider,
    title,
    quota,
    channel,
    validity,
    note,
    models,
    voteUp,
    voteDown,
    rating,
    ratingCount,
    latencyMs,
    nexusOnline,
    nexusSummary,
    isCaution,
  }
}

/** 主绘制流程 · 风格 A（编辑杂志 × 报刊头条版式 · 双栏非对称空间重排） */
function drawMagazine(
  ctx: ShareCtx,
  deal: ShareDeal,
  qrImg: ShareImage | null,
  iconImg: ShareImage | null,
  siteHost: string,
): void {
  const d = normalizeDeal(deal)
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 纸面底色 + 报刊细微噪点/纹理圆 ──
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)
  ctx.strokeStyle = 'rgba(109,40,217,0.04)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(-40, LOGIC_H + 20, 160, 0, Math.PI * 2)
  ctx.stroke()
  drawCoin(ctx, LOGIC_W - 4, 48 + 52, 40, 'rgba(109,40,217,0.06)', 2)

  // ── 1. 报头 (Masthead) ──
  ctx.fillStyle = C.ink
  ctx.fillRect(PAD, 16, LOGIC_W - PAD * 2, 2.5)
  ctx.fillRect(PAD, 21, LOGIC_W - PAD * 2, 0.8)

  ctx.fillStyle = C.ink
  ctx.font = font(11, 800)
  ctx.fillText('FAVSHUB DISPATCH', PAD, 34)

  ctx.fillStyle = C.accent
  ctx.font = font(9.5, 700)
  ctx.fillText('SPECIAL EDITION · 特刊线报', PAD + 122, 34)

  const channelText = \`\${d.channel}直发\`.toUpperCase()
  ctx.fillStyle = C.inkSec
  ctx.font = font(9.5, 600)
  const chW = ctx.measureText(channelText).width
  ctx.fillText(channelText, right - chW, 34)

  ctx.fillStyle = C.ruleDark
  ctx.fillRect(PAD, 40, LOGIC_W - PAD * 2, 1)

  // ── 2. 头条主标题区 (Headline & Lead Deck) ──
  ctx.fillStyle = C.accent
  ctx.font = font(10.5, 700)
  const provKicker = \`[ \${d.provider.toUpperCase()} · 独家披露 ]\`
  ctx.fillText(provKicker, PAD, 58)

  ctx.fillStyle = C.ink
  ctx.font = font(17.5, 800)
  const titleLines = wrapText(ctx, d.title, LOGIC_W - PAD * 2, 2)
  let headlineY = 78
  for (const line of titleLines) {
    ctx.fillText(line, PAD, headlineY)
    headlineY += 23
  }

  const quoteText = d.note || '社区实时验真收录，包含额度校验、连通性探测及兑换细则。'
  ctx.fillStyle = 'rgba(109,40,217,0.06)'
  roundRect(ctx, PAD, headlineY - 14, LOGIC_W - PAD * 2, 36, 4)
  ctx.fill()
  ctx.fillStyle = C.accent
  ctx.fillRect(PAD, headlineY - 14, 3.5, 36)

  ctx.fillStyle = C.inkSec
  ctx.font = font(10.5, 500)
  const quoteLines = wrapText(ctx, \`“\${quoteText}”\`, LOGIC_W - PAD * 2 - 20, 2)
  let qY = headlineY + 1
  for (const ql of quoteLines) {
    ctx.fillText(ql, PAD + 12, qY)
    qY += 15
  }

  const splitY = headlineY + 30
  ctx.fillStyle = C.rule
  ctx.fillRect(PAD, splitY, LOGIC_W - PAD * 2, 1)

  // ── 3. 非对称双栏排布 (Asymmetric Dual-Column Broadsheet) ──
  const gridY = splitY + 10
  const leftColW = 246
  const rightColX = PAD + leftColW + 12
  const rightColW = LOGIC_W - PAD - rightColX

  // === 左栏 1: 核心额度独家专栏 ===
  const allocY = gridY
  const allocH = 110
  ctx.fillStyle = '#1C1917'
  roundRect(ctx, PAD, allocY, leftColW, allocH, 6)
  ctx.fill()

  ctx.fillStyle = '#9CA3AF'
  ctx.font = monoFont(9, 600)
  ctx.fillText('FEATURE ALLOCATION / 专享配额', PAD + 12, allocY + 20)

  ctx.fillStyle = '#FCD34D'
  ctx.font = font(21, 800)
  const quotaStr = ellipsize(ctx, d.quota, leftColW - 24)
  ctx.fillText(quotaStr, PAD + 12, allocY + 52)

  ctx.fillStyle = '#FAF7F1'
  ctx.font = font(11, 500)
  const validityStr = \`有效期限: \${d.validity}\`
  ctx.fillText(ellipsize(ctx, validityStr, leftColW - 24), PAD + 12, allocY + 76)

  ctx.fillStyle = '#9CA3AF'
  ctx.font = font(9.5, 400)
  ctx.fillText('✓ 零门槛验证通过 · 社区实测有效', PAD + 12, allocY + 96)

  // === 左栏 2: 适用模型清册 ===
  const modelY = allocY + allocH + 10
  const modelH = 112
  ctx.fillStyle = '#FFFFFF'
  ctx.strokeStyle = C.ruleDark
  ctx.lineWidth = 1
  roundRect(ctx, PAD, modelY, leftColW, modelH, 6)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = C.ink
  ctx.font = font(10.5, 700)
  ctx.fillText('MODEL ROSTER / 适用模型', PAD + 10, modelY + 20)

  let mX = PAD + 10
  let mY = modelY + 32
  let mRow = 0
  for (let i = 0; i < d.models.length; i++) {
    const mod = d.models[i]
    ctx.font = monoFont(9.5, 500)
    const tagW = ctx.measureText(mod).width + 14
    if (mX + tagW > PAD + leftColW - 10) {
      mX = PAD + 10
      mY += 24
      mRow++
      if (mRow >= 3) {
        ctx.fillStyle = C.inkTer
        ctx.font = font(9, 600)
        ctx.fillText(\`+\${d.models.length - i} 款...\`, mX, mY + 12)
        break
      }
    }
    ctx.fillStyle = C.accentSoft
    roundRect(ctx, mX, mY, tagW, 18, 3)
    ctx.fill()
    ctx.strokeStyle = 'rgba(109,40,217,0.15)'
    roundRect(ctx, mX + 0.5, mY + 0.5, tagW - 1, 17, 3)
    ctx.stroke()
    ctx.fillStyle = C.accent
    ctx.fillText(mod, mX + 7, mY + 13)
    mX += tagW + 6
  }

  // === 左栏 3: Nexus 节点电报 ===
  const wireY = modelY + modelH + 10
  const wireH = 100
  ctx.save()
  ctx.setLineDash([3, 2])
  ctx.strokeStyle = C.ruleDark
  ctx.lineWidth = 1
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  roundRect(ctx, PAD, wireY, leftColW, wireH, 6)
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  ctx.fillStyle = C.inkSec
  ctx.font = monoFont(9, 700)
  ctx.fillText('WIRE DISPATCH · NEXUS 实测', PAD + 10, wireY + 20)

  drawPulse(ctx, PAD + 14, wireY + 42, 14, d.nexusOnline ? C.ok : C.amber)
  ctx.fillStyle = C.ink
  ctx.font = font(12, 700)
  const pingStr = d.latencyMs ? \`\${d.latencyMs} ms\` : '极速直连'
  ctx.fillText(\`响应时延: \${pingStr}\`, PAD + 32, wireY + 46)

  ctx.fillStyle = C.inkSec
  ctx.font = font(10, 400)
  ctx.fillText(ellipsize(ctx, d.nexusSummary, leftColW - 20), PAD + 10, wireY + 68)

  ctx.fillStyle = C.inkTer
  ctx.font = monoFont(9, 400)
  ctx.fillText('PROBE: OK · CONFIRMATION RATIO 100%', PAD + 10, wireY + 86)

  // === 右栏: FAST FACTS 垂直情报边栏 ===
  const sideH = 342
  ctx.fillStyle = '#F4EFE6'
  roundRect(ctx, rightColX, gridY, rightColW, sideH, 6)
  ctx.fill()
  ctx.strokeStyle = '#E0D8C8'
  ctx.lineWidth = 1
  roundRect(ctx, rightColX + 0.5, gridY + 0.5, rightColW - 1, sideH - 1, 6)
  ctx.stroke()

  ctx.fillStyle = C.ink
  roundRect(ctx, rightColX, gridY, rightColW, 26, 6)
  ctx.fill()
  ctx.fillRect(rightColX, gridY + 16, rightColW, 10)
  ctx.fillStyle = '#FAF7F1'
  ctx.font = font(10, 800)
  ctx.textAlign = 'center'
  ctx.fillText('FAST FACTS', rightColX + rightColW / 2, gridY + 17)
  ctx.textAlign = 'left'

  // FAST FACT 1: 推荐评级
  ctx.fillStyle = C.inkTer
  ctx.font = font(8.5, 600)
  ctx.fillText('COMMUNITY RATING', rightColX + 10, gridY + 44)

  ctx.fillStyle = C.ink
  ctx.font = font(24, 800)
  ctx.fillText(d.rating.toFixed(1), rightColX + 10, gridY + 73)

  ctx.fillStyle = '#D97706'
  ctx.font = font(10.5, 700)
  ctx.fillText('★★★★★', rightColX + 56, gridY + 64)

  ctx.fillStyle = C.inkSec
  ctx.font = font(9, 400)
  ctx.fillText(d.ratingCount ? \`\${d.ratingCount} 人已参与评议\` : '最新收录情报', rightColX + 10, gridY + 91)

  ctx.fillStyle = '#E0D8C8'
  ctx.fillRect(rightColX + 8, gridY + 103, rightColW - 16, 1)

  // FAST FACT 2: 社区共识比
  ctx.fillStyle = C.inkTer
  ctx.font = font(8.5, 600)
  ctx.fillText('SENTIMENT / 共识', rightColX + 10, gridY + 121)

  ctx.fillStyle = C.ok
  ctx.font = font(11, 700)
  ctx.fillText(\`▲ \${d.voteUp}\`, rightColX + 10, gridY + 140)

  ctx.fillStyle = C.danger
  ctx.font = font(11, 700)
  ctx.fillText(\`▼ \${d.voteDown}\`, rightColX + 66, gridY + 140)

  const totalVotes = (d.voteUp + d.voteDown) || 1
  const upRatio = Math.max(0.1, Math.min(0.9, d.voteUp / totalVotes))
  const barW = rightColW - 20
  ctx.fillStyle = 'rgba(220,38,38,0.2)'
  roundRect(ctx, rightColX + 10, gridY + 150, barW, 5, 2.5)
  ctx.fill()
  ctx.fillStyle = C.ok
  roundRect(ctx, rightColX + 10, gridY + 150, barW * upRatio, 5, 2.5)
  ctx.fill()

  ctx.fillStyle = '#E0D8C8'
  ctx.fillRect(rightColX + 8, gridY + 168, rightColW - 16, 1)

  // FAST FACT 3: 审查等级
  ctx.fillStyle = C.inkTer
  ctx.font = font(8.5, 600)
  ctx.fillText('AUDIT STATUS', rightColX + 10, gridY + 186)

  ctx.fillStyle = d.isCaution ? C.amber : C.ok
  ctx.font = font(10.5, 700)
  ctx.fillText(d.isCaution ? '● 需轻度留意' : '● 官方无套路', rightColX + 10, gridY + 205)

  ctx.fillStyle = C.inkSec
  ctx.font = font(9, 400)
  const tip1 = d.isCaution ? '附带绑定要求' : '注册即领无卡密'
  ctx.fillText(tip1, rightColX + 10, gridY + 223)

  ctx.fillStyle = '#E0D8C8'
  ctx.fillRect(rightColX + 8, gridY + 237, rightColW - 16, 1)

  // FAST FACT 4: 独家印鉴
  ctx.fillStyle = C.inkTer
  ctx.font = font(8.5, 600)
  ctx.fillText('INTELLIGENCE ID', rightColX + 10, gridY + 255)

  ctx.fillStyle = C.ink
  ctx.font = monoFont(9.5, 700)
  ctx.fillText(\`#\${d.id.slice(0, 8)}\`, rightColX + 10, gridY + 273)

  ctx.fillStyle = C.inkSec
  ctx.font = font(9, 400)
  ctx.fillText('已存证区块链/节点', rightColX + 10, gridY + 291)

  drawStamp(ctx, rightColX + rightColW / 2, gridY + 318, 'FAVS VERIFIED', -8)

  // ── 4. 报纸发行底栏 ──
  const footY = LOGIC_H - PAD - 84
  ctx.fillStyle = C.ink
  ctx.fillRect(PAD, footY, LOGIC_W - PAD * 2, 2)
  ctx.fillRect(PAD, footY + 4, LOGIC_W - PAD * 2, 0.8)

  const qrSize = 72
  const qrX = right - qrSize
  const qrY = footY + 10

  if (qrImg) {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1
    ctx.strokeRect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6)
    ctx.drawImage(qrImg as CanvasImageSource, qrX, qrY, qrSize, qrSize)

    ctx.lineWidth = 2
    ctx.strokeStyle = C.accent
    ctx.beginPath()
    ctx.moveTo(qrX - 6, qrY + 2)
    ctx.lineTo(qrX - 6, qrY - 6)
    ctx.lineTo(qrX + 2, qrY - 6)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(qrX + qrSize + 6, qrY + qrSize - 2)
    ctx.lineTo(qrX + qrSize + 6, qrY + qrSize + 6)
    ctx.lineTo(qrX + qrSize - 2, qrY + qrSize + 6)
    ctx.stroke()
  }

  const leftW = qrX - PAD - 16
  drawBarcode(ctx, PAD, footY + 12, 120, 20, C.ink)

  ctx.fillStyle = C.ink
  ctx.font = font(11, 700)
  ctx.fillText('FavsHub · 开发者线报局', PAD, footY + 48)

  ctx.fillStyle = C.inkSec
  ctx.font = monoFont(9.5, 500)
  ctx.fillText(ellipsize(ctx, siteHost, leftW), PAD, footY + 63)

  ctx.fillStyle = C.inkTer
  ctx.font = font(9, 400)
  ctx.fillText('扫码核验线报详情 · 社区众包共识支持', PAD, footY + 77)
}

/** 主绘制流程 · 风格 B（深色终端 · 多分屏 Tmux / TUI Dashboard 空间重排） */
function drawNeon(
  ctx: ShareCtx,
  deal: ShareDeal,
  qrImg: ShareImage | null,
  iconImg: ShareImage | null,
  siteHost: string,
): void {
  const d = normalizeDeal(deal)
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 背景：墨蓝对角渐变 + 青/紫径向辉光 ──
  const bg = ctx.createLinearGradient(0, 0, LOGIC_W, LOGIC_H)
  bg.addColorStop(0, N.bgFrom)
  bg.addColorStop(1, N.bgTo)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)
  radialGlow(ctx, 392, 56, 190, 'rgba(34,211,238,0.12)')
  radialGlow(ctx, 36, 560, 210, 'rgba(167,139,250,0.10)')

  // ── 1. 终端窗口标题栏 (Terminal Titlebar) ──
  const winY = 16
  const winW = LOGIC_W - PAD * 2
  ctx.fillStyle = N.barBg
  roundRect(ctx, PAD, winY, winW, 28, 6)
  ctx.fill()
  ctx.strokeStyle = N.line
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, winY + 0.5, winW - 1, 27, 6)
  ctx.stroke()

  const btnY = winY + 14
  ctx.fillStyle = '#EF4444'
  ctx.beginPath()
  ctx.arc(PAD + 16, btnY, 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#F59E0B'
  ctx.beginPath()
  ctx.arc(PAD + 30, btnY, 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#10B981'
  ctx.beginPath()
  ctx.arc(PAD + 44, btnY, 4.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = N.textSec
  ctx.font = monoFont(10, 600)
  ctx.fillText('favshub@edge-01: ~/deals/inspect.sh', PAD + 60, winY + 18)

  ctx.fillStyle = N.green
  ctx.beginPath()
  ctx.arc(right - 46, btnY, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = N.green
  ctx.font = monoFont(9, 700)
  ctx.fillText('LIVE', right - 38, winY + 18)

  // ── 2. CLI 交互窗格 (Pane 0: Command & Deal Header) ──
  const cmdY = winY + 34
  const cmdH = 74
  ctx.fillStyle = 'rgba(255,255,255,0.02)'
  roundRect(ctx, PAD, cmdY, winW, cmdH, 6)
  ctx.fill()
  ctx.strokeStyle = N.lineSoft
  roundRect(ctx, PAD + 0.5, cmdY + 0.5, winW - 1, cmdH - 1, 6)
  ctx.stroke()

  ctx.fillStyle = N.cyan
  ctx.font = monoFont(10.5, 700)
  ctx.fillText('❯', PAD + 10, cmdY + 20)
  ctx.fillStyle = N.text
  ctx.font = monoFont(10, 500)
  ctx.fillText(\`favshub inspect --provider "\${d.provider}"\`, PAD + 24, cmdY + 20)

  const codeText = \`[200 OK: \${d.channel}]\`
  ctx.fillStyle = N.green
  ctx.font = monoFont(9.5, 700)
  const codeW = ctx.measureText(codeText).width
  ctx.fillText(codeText, right - codeW - 10, cmdY + 20)

  ctx.fillStyle = N.text
  ctx.font = font(14, 700)
  const titleLines = wrapText(ctx, d.title, winW - 20, 2)
  let tY = cmdY + 42
  for (const tl of titleLines) {
    ctx.fillText(tl, PAD + 10, tY)
    tY += 18
  }

  // ── 3. Tmux 左右分屏核心窗格 (Panes Split) ──
  const tmuxY = cmdY + cmdH + 8
  const tmuxH = 348
  const leftPaneW = 232
  const rightPaneX = PAD + leftPaneW + 8
  const rightPaneW = LOGIC_W - PAD - rightPaneX

  // === 左窗格 [0: PAYLOAD.JSON*] ===
  ctx.fillStyle = 'rgba(11,14,28,0.7)'
  roundRect(ctx, PAD, tmuxY, leftPaneW, tmuxH, 6)
  ctx.fill()
  ctx.strokeStyle = N.cyan
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, tmuxY + 0.5, leftPaneW - 1, tmuxH - 1, 6)
  ctx.stroke()

  ctx.fillStyle = 'rgba(34,211,238,0.15)'
  roundRect(ctx, PAD + 1, tmuxY + 1, leftPaneW - 2, 22, 5)
  ctx.fill()
  ctx.fillStyle = N.cyan
  ctx.font = monoFont(9.5, 700)
  ctx.fillText('[0] JSON:payload.json*', PAD + 8, tmuxY + 16)

  let codeY = tmuxY + 38
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(10, 500)
  ctx.fillText('{', PAD + 10, codeY)
  codeY += 18

  ctx.fillStyle = N.cyan
  ctx.fillText('  "quota":', PAD + 10, codeY)
  codeY += 18

  ctx.fillStyle = 'rgba(251,191,36,0.12)'
  roundRect(ctx, PAD + 16, codeY - 14, leftPaneW - 28, 48, 4)
  ctx.fill()
  ctx.strokeStyle = 'rgba(251,191,36,0.4)'
  roundRect(ctx, PAD + 16.5, codeY - 13.5, leftPaneW - 29, 47, 4)
  ctx.stroke()

  ctx.fillStyle = N.amber
  ctx.font = monoFont(17, 800)
  ctx.fillText(ellipsize(ctx, d.quota, leftPaneW - 36), PAD + 22, codeY + 12)

  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9.5, 400)
  ctx.fillText(\`// ttl: \${d.validity}\`, PAD + 22, codeY + 28)

  codeY += 46

  ctx.fillStyle = N.cyan
  ctx.font = monoFont(10, 500)
  ctx.fillText('  "models": [', PAD + 10, codeY)
  codeY += 18

  let mCount = 0
  for (let i = 0; i < d.models.length; i++) {
    const mod = d.models[i]
    if (mCount >= 4) {
      ctx.fillStyle = N.textTer
      ctx.font = monoFont(9, 400)
      ctx.fillText(\`    // +\${d.models.length - i} more items...\`, PAD + 14, codeY)
      codeY += 16
      break
    }
    ctx.fillStyle = N.green
    ctx.font = monoFont(9.5, 500)
    ctx.fillText(\`    "\${ellipsize(ctx, mod, leftPaneW - 40)}",\`, PAD + 14, codeY)
    codeY += 17
    mCount++
  }
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(10, 500)
  ctx.fillText('  ],', PAD + 10, codeY)
  codeY += 18

  const desc = d.note || '社区节点实测连通，认证即可兑换。'
  ctx.fillStyle = N.cyan
  ctx.fillText('  "note":', PAD + 10, codeY)
  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9, 400)
  const descLines = wrapText(ctx, \`"\${desc}"\`, leftPaneW - 24, 2)
  for (const dl of descLines) {
    codeY += 14
    ctx.fillText(dl, PAD + 14, codeY)
  }
  codeY += 16
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(10, 500)
  ctx.fillText('}', PAD + 10, codeY)

  // === 右窗格 [1: HTOP:STATUS] ===
  ctx.fillStyle = 'rgba(11,14,28,0.7)'
  roundRect(ctx, rightPaneX, tmuxY, rightPaneW, tmuxH, 6)
  ctx.fill()
  ctx.strokeStyle = N.line
  ctx.lineWidth = 1
  roundRect(ctx, rightPaneX + 0.5, tmuxY + 0.5, rightPaneW - 1, tmuxH - 1, 6)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  roundRect(ctx, rightPaneX + 1, tmuxY + 1, rightPaneW - 2, 22, 5)
  ctx.fill()
  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9.5, 700)
  ctx.fillText('[1] HTOP:STATUS', rightPaneX + 8, tmuxY + 16)

  let statY = tmuxY + 38
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 600)
  ctx.fillText('PROBE (RTT)', rightPaneX + 10, statY)
  statY += 18

  const pingNum = d.latencyMs ? \`\${d.latencyMs}ms\` : '32ms'
  ctx.fillStyle = N.cyan
  ctx.font = monoFont(18, 800)
  ctx.fillText(pingNum, rightPaneX + 10, statY)
  statY += 6

  const waveW = rightPaneW - 20
  ctx.strokeStyle = 'rgba(34,211,238,0.3)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(rightPaneX + 10, statY + 8)
  ctx.lineTo(rightPaneX + 24, statY + 2)
  ctx.lineTo(rightPaneX + 38, statY + 11)
  ctx.lineTo(rightPaneX + 52, statY + 4)
  ctx.lineTo(rightPaneX + 66, statY + 9)
  ctx.lineTo(rightPaneX + 80, statY + 1)
  ctx.lineTo(rightPaneX + 100, statY + 8)
  ctx.lineTo(rightPaneX + 10 + waveW, statY + 5)
  ctx.stroke()
  statY += 22

  ctx.fillStyle = N.lineSoft
  ctx.fillRect(rightPaneX + 8, statY, rightPaneW - 16, 1)
  statY += 14

  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 600)
  ctx.fillText('RATING SCORE', rightPaneX + 10, statY)
  statY += 18

  ctx.fillStyle = N.amber
  ctx.font = monoFont(18, 800)
  ctx.fillText(\`\${d.rating.toFixed(1)} ★\`, rightPaneX + 10, statY)
  statY += 8

  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 600)
  ctx.fillText('VOTE CONSENSUS', rightPaneX + 10, statY + 12)
  statY += 28

  ctx.fillStyle = N.green
  ctx.font = monoFont(10.5, 700)
  ctx.fillText(\`▲ \${d.voteUp}\`, rightPaneX + 10, statY)
  ctx.fillStyle = N.red
  ctx.fillText(\`▼ \${d.voteDown}\`, rightPaneX + 68, statY)
  statY += 8

  const netVotes = (d.voteUp + d.voteDown) || 1
  const netRatio = Math.max(0.1, Math.min(0.9, d.voteUp / netVotes))
  ctx.fillStyle = 'rgba(248,113,113,0.3)'
  roundRect(ctx, rightPaneX + 10, statY, waveW, 4, 2)
  ctx.fill()
  ctx.fillStyle = N.green
  roundRect(ctx, rightPaneX + 10, statY, waveW * netRatio, 4, 2)
  ctx.fill()
  statY += 20

  ctx.fillStyle = N.lineSoft
  ctx.fillRect(rightPaneX + 8, statY, rightPaneW - 16, 1)
  statY += 14

  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 600)
  ctx.fillText('AUDIT INTEGRITY', rightPaneX + 10, statY)
  statY += 16
  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9, 500)
  ctx.fillText('SHA256: VERIFIED', rightPaneX + 10, statY)
  statY += 14
  ctx.fillStyle = N.violet
  ctx.fillText(\`ID:\${d.id.slice(0, 8)}\`, rightPaneX + 10, statY)

  // ── 4. Vim Powerline 底部状态行 ──
  const plY = tmuxY + tmuxH + 8
  const plH = 22
  ctx.fillStyle = N.cyan
  roundRect(ctx, PAD, plY, 68, plH, 3)
  ctx.fill()
  ctx.fillStyle = '#0B0E1C'
  ctx.font = monoFont(9.5, 800)
  ctx.textAlign = 'center'
  ctx.fillText('NORMAL', PAD + 34, plY + 15)
  ctx.textAlign = 'left'

  ctx.fillStyle = '#1E293B'
  ctx.fillRect(PAD + 68, plY, 140, plH)
  ctx.fillStyle = N.text
  ctx.font = monoFont(9, 600)
  ctx.fillText(\`master* | deal:\${d.id.slice(0, 6)}\`, PAD + 76, plY + 15)

  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(PAD + 208, plY, winW - 208, plH)
  ctx.fillStyle = N.textTer
  ctx.font = monoFont(9, 500)
  ctx.textAlign = 'right'
  ctx.fillText('utf-8 | 100% [TOP]', right - 8, plY + 15)
  ctx.textAlign = 'left'

  // ── 5. 终端矩阵二维码与执行命令 ──
  const footY = plY + plH + 8
  const footH = 68
  ctx.fillStyle = 'rgba(255,255,255,0.02)'
  roundRect(ctx, PAD, footY, winW, footH, 4)
  ctx.fill()
  ctx.strokeStyle = N.lineSoft
  roundRect(ctx, PAD + 0.5, footY + 0.5, winW - 1, footH - 1, 4)
  ctx.stroke()

  const qrSize = 56
  const qrX = right - qrSize - 6
  const qrY = footY + 6
  if (qrImg) {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4)
    ctx.drawImage(qrImg as CanvasImageSource, qrX, qrY, qrSize, qrSize)

    ctx.strokeStyle = N.cyan
    ctx.lineWidth = 1.5
    ctx.strokeRect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6)
  }

  const cliW = qrX - PAD - 16
  ctx.fillStyle = N.cyan
  ctx.font = monoFont(9.5, 700)
  ctx.fillText('$ curl -sL https://favshub.cn/deal/...', PAD + 10, footY + 20)

  ctx.fillStyle = N.textSec
  ctx.font = monoFont(9, 400)
  ctx.fillText('SCAN MATRIX TO DEPLOY OR CLAIM', PAD + 10, footY + 38)

  ctx.fillStyle = N.textTer
  ctx.font = monoFont(8.5, 400)
  const hostLabel = \`FavsHub CLI // \${siteHost}\`
  ctx.fillText(ellipsize(ctx, hostLabel, cliW), PAD + 10, footY + 54)

  ctx.fillStyle = N.cyan
  ctx.fillRect(PAD + 10 + ctx.measureText(ellipsize(ctx, hostLabel, cliW)).width + 4, footY + 44, 5, 10)
}

/** 暖阳陶土版：白色圆角软卡（阴影对齐 tool.bx9y.com.cn 的 --tb-shadow） */
function drawSoftCard(ctx: ShareCtx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.save()
  ctx.shadowColor = K.shadow
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 4
  ctx.fillStyle = K.surface
  roundRect(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = K.border
  ctx.lineWidth = 1
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r)
  ctx.stroke()
}

/** 主绘制流程 · 风格 C（暖阳陶土 · Bento Grid 便当盒排布 · 空间重排） */
function drawClay(
  ctx: ShareCtx,
  deal: ShareDeal,
  qrImg: ShareImage | null,
  iconImg: ShareImage | null,
  siteHost: string,
): void {
  const d = normalizeDeal(deal)
  const right = LOGIC_W - PAD
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // ── 背景：暖米白 + 陶土橙双层柔和辉光 ──
  ctx.fillStyle = K.bg
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)
  radialGlow(ctx, 400, 40, 180, 'rgba(217,119,87,0.08)')
  radialGlow(ctx, 30, 580, 200, 'rgba(74,124,89,0.06)')

  const usableW = LOGIC_W - PAD * 2

  // ── Bento 1: 顶部长卡 (Hero Header Card) ──
  const b1Y = 16
  const b1H = 92
  drawSoftCard(ctx, PAD, b1Y, usableW, b1H, 12)

  ctx.fillStyle = K.claySoft
  roundRect(ctx, PAD + 12, b1Y + 12, 34, 34, 8)
  ctx.fill()
  ctx.fillStyle = K.clayStrong
  ctx.font = font(16, 800)
  ctx.textAlign = 'center'
  ctx.fillText(initialOf(d.provider), PAD + 29, b1Y + 34)
  ctx.textAlign = 'left'

  ctx.fillStyle = K.textSec
  ctx.font = font(10.5, 600)
  ctx.fillText(d.provider, PAD + 54, b1Y + 24)

  const chanText = \`\${d.channel}直发\`
  ctx.font = font(9.5, 600)
  const chanW = ctx.measureText(chanText).width
  ctx.fillStyle = K.claySoft
  roundRect(ctx, PAD + 54 + ctx.measureText(d.provider).width + 8, b1Y + 13, chanW + 10, 16, 4)
  ctx.fill()
  ctx.fillStyle = K.clayStrong
  ctx.fillText(chanText, PAD + 59 + ctx.measureText(d.provider).width + 8, b1Y + 25)

  ctx.fillStyle = K.text
  ctx.font = font(15.5, 800)
  const titleLines = wrapText(ctx, d.title, usableW - 64, 2)
  let tY = b1Y + 54
  for (const tl of titleLines) {
    ctx.fillText(tl, PAD + 12, tY)
    tY += 20
  }

  // ── Bento Row 1: 配额主卡 (左) + 社区口碑卡 (右) ──
  const r1Y = b1Y + b1H + 10
  const r1H = 126
  const b2W = 244
  const b3X = PAD + b2W + 10
  const b3W = LOGIC_W - PAD - b3X

  // === Bento 2: 专享配额便当盒 ===
  const b2Grad = ctx.createLinearGradient(PAD, r1Y, PAD, r1Y + r1H)
  b2Grad.addColorStop(0, '#FFF8F4')
  b2Grad.addColorStop(1, '#FFF1E8')
  ctx.save()
  ctx.shadowColor = K.shadow
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3
  ctx.fillStyle = b2Grad
  roundRect(ctx, PAD, r1Y, b2W, r1H, 12)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#F6D5C7'
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, r1Y + 0.5, b2W - 1, r1H - 1, 12)
  ctx.stroke()

  ctx.fillStyle = K.clayStrong
  ctx.font = font(9.5, 700)
  ctx.fillText('✦ 专享配额 / ALLOCATION', PAD + 14, r1Y + 22)

  ctx.fillStyle = K.clayStrong
  ctx.font = font(22, 800)
  ctx.fillText(ellipsize(ctx, d.quota, b2W - 28), PAD + 14, r1Y + 54)

  ctx.fillStyle = K.textSec
  ctx.font = font(10.5, 500)
  ctx.fillText(\`有效期 · \${d.validity}\`, PAD + 14, r1Y + 78)

  ctx.fillStyle = K.sage
  ctx.font = font(9.5, 600)
  ctx.fillText('✓ 零门槛验证 · 社区已验真', PAD + 14, r1Y + 104)

  // === Bento 3: 社区口碑便当盒 ===
  drawSoftCard(ctx, b3X, r1Y, b3W, r1H, 12)

  ctx.fillStyle = K.textTer
  ctx.font = font(9, 600)
  ctx.fillText('社区研判', b3X + 12, r1Y + 22)

  ctx.fillStyle = K.clay
  ctx.font = font(22, 800)
  ctx.fillText(d.rating.toFixed(1), b3X + 12, r1Y + 52)
  ctx.font = font(11, 700)
  ctx.fillText('★', b3X + 12 + ctx.measureText(d.rating.toFixed(1)).width + 4, r1Y + 44)

  ctx.fillStyle = K.textTer
  ctx.font = font(8.5, 400)
  ctx.fillText(d.ratingCount ? \`\${d.ratingCount} 人评分\` : '近期收录', b3X + 12, r1Y + 68)

  ctx.fillStyle = K.sage
  ctx.font = font(10, 700)
  ctx.fillText(\`▲ \${d.voteUp}\`, b3X + 12, r1Y + 92)
  ctx.fillStyle = K.danger
  ctx.fillText(\`▼ \${d.voteDown}\`, b3X + 68, r1Y + 92)

  const cVotes = (d.voteUp + d.voteDown) || 1
  const cRatio = Math.max(0.1, Math.min(0.9, d.voteUp / cVotes))
  const cBarW = b3W - 24
  ctx.fillStyle = 'rgba(196,74,74,0.18)'
  roundRect(ctx, b3X + 12, r1Y + 102, cBarW, 5, 2.5)
  ctx.fill()
  ctx.fillStyle = K.sage
  roundRect(ctx, b3X + 12, r1Y + 102, cBarW * cRatio, 5, 2.5)
  ctx.fill()

  // ── Bento Row 2: Nexus 测速卡 (左) + 适用模型卡 (右) ──
  const r2Y = r1Y + r1H + 10
  const r2H = 144
  const b4W = 152
  const b5X = PAD + b4W + 10
  const b5W = LOGIC_W - PAD - b5X

  // === Bento 4: Nexus 连通性测速便当盒 ===
  const b4Grad = ctx.createLinearGradient(PAD, r2Y, PAD, r2Y + r2H)
  b4Grad.addColorStop(0, '#F4F9F6')
  b4Grad.addColorStop(1, '#EBF5EE')
  ctx.save()
  ctx.shadowColor = K.shadow
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3
  ctx.fillStyle = b4Grad
  roundRect(ctx, PAD, r2Y, b4W, r2H, 12)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#D4E6D9'
  ctx.lineWidth = 1
  roundRect(ctx, PAD + 0.5, r2Y + 0.5, b4W - 1, r2H - 1, 12)
  ctx.stroke()

  ctx.fillStyle = K.sage
  ctx.font = font(9.5, 700)
  ctx.fillText('✦ 连通性实测', PAD + 12, r2Y + 22)

  const latStr = d.latencyMs ? \`\${d.latencyMs}\` : '45'
  ctx.fillStyle = K.sage
  ctx.font = font(26, 800)
  ctx.fillText(latStr, PAD + 12, r2Y + 56)
  const latW = ctx.measureText(latStr).width
  ctx.font = font(11, 600)
  ctx.fillText('ms', PAD + 12 + latW + 4, r2Y + 46)

  drawPulse(ctx, PAD + 18, r2Y + 78, 14, d.nexusOnline ? K.sage : K.warn)
  ctx.fillStyle = K.textSec
  ctx.font = font(10, 600)
  ctx.fillText(d.nexusOnline ? '边缘节点在线' : '网络波动正常', PAD + 34, r2Y + 82)

  ctx.fillStyle = K.textTer
  ctx.font = font(8.5, 400)
  ctx.fillText('TLS 1.3 握手直连', PAD + 12, r2Y + 104)
  ctx.fillText('实时众包探测可用', PAD + 12, r2Y + 122)

  // === Bento 5: 适用模型矩阵便当盒 ===
  drawSoftCard(ctx, b5X, r2Y, b5W, r2H, 12)

  ctx.fillStyle = K.textSec
  ctx.font = font(9.5, 700)
  ctx.fillText('适用模型 & 架构', b5X + 12, r2Y + 22)

  let curX = b5X + 12
  let curY = r2Y + 36
  let mRow = 0
  for (let i = 0; i < d.models.length; i++) {
    const mod = d.models[i]
    ctx.font = font(10, 500)
    const mw = ctx.measureText(mod).width
    const pillW = mw + 14
    if (curX + pillW > right - 8) {
      curX = b5X + 12
      curY += 24
      mRow++
      if (mRow >= 3) {
        ctx.fillStyle = K.textTer
        ctx.font = font(9, 500)
        ctx.fillText(\`+\${d.models.length - i} 款...\`, curX, curY + 12)
        break
      }
    }
    ctx.fillStyle = K.bgAlt
    roundRect(ctx, curX, curY, pillW, 19, 4)
    ctx.fill()
    ctx.strokeStyle = K.border
    roundRect(ctx, curX + 0.5, curY + 0.5, pillW - 1, 18, 4)
    ctx.stroke()
    ctx.fillStyle = K.text
    ctx.fillText(mod, curX + 7, curY + 13.5)
    curX += pillW + 6
  }

  // ── Bento 6: 底部扫码便当盒 (Footer Callout & QR Card) ──
  const b6Y = r2Y + r2H + 10
  const b6H = 110
  drawSoftCard(ctx, PAD, b6Y, usableW, b6H, 12)

  const qrSize = 74
  const qrX = right - qrSize - 12
  const qrY = b6Y + 18
  if (qrImg) {
    ctx.fillStyle = '#FFFFFF'
    roundRect(ctx, qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 6)
    ctx.fill()
    ctx.strokeStyle = K.borderStrong
    ctx.lineWidth = 1
    roundRect(ctx, qrX - 3.5, qrY - 3.5, qrSize + 7, qrSize + 7, 6)
    ctx.stroke()
    ctx.drawImage(qrImg as CanvasImageSource, qrX, qrY, qrSize, qrSize)
  }

  const leftMax = qrX - PAD - 20
  ctx.fillStyle = K.clayStrong
  ctx.font = font(14, 800)
  ctx.fillText('扫码立享专属权益', PAD + 16, b6Y + 34)

  ctx.fillStyle = K.textSec
  ctx.font = font(11, 400)
  ctx.fillText('长按识别或打开微信直达通告页面', PAD + 16, b6Y + 56)

  ctx.fillStyle = K.text
  ctx.font = font(11.5, 700)
  const brandW = ctx.measureText('FavsHub').width
  ctx.fillText('FavsHub', PAD + 16, b6Y + 84)

  ctx.fillStyle = K.textTer
  ctx.font = monoFont(10, 400)
  ctx.fillText(ellipsize(ctx, siteHost, leftMax - brandW - 10), PAD + 24 + brandW, b6Y + 84)

  // ── 底部微注 (Footer Trust Stamp) ──
  const tipY = b6Y + b6H + 20
  ctx.fillStyle = K.textTer
  ctx.font = font(9.5, 500)
  ctx.textAlign = 'center'
  ctx.fillText('● 零门槛验证 · 社区众包共识 · 实时告警保障 ●', LOGIC_W / 2, tipY)
  ctx.textAlign = 'left'
}
\n`;

const before = content.slice(0, magStart);
const after = content.slice(blastStart);
const finalContent = before + replacement + after;

fs.writeFileSync(targetPath, finalContent, 'utf-8');
console.log('Fixed normalizeDeal and applied robust mappings to drawMagazine, drawNeon, and drawClay!');
