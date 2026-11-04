<template>
  <div class="deal-page">
    <header class="deal-page-header">
      <div class="deal-page-header-inner">
        <div class="deal-page-header-left">
          <NuxtLink to="/" class="deal-page-logo" title="返回主页">
            <img src="/images/logo.svg" alt="FavsHub" class="deal-page-logo-img">
          </NuxtLink>
          <nav class="deal-breadcrumb">
            <NuxtLink to="/tokens" class="deal-crumb-link">Token 白嫖通告</NuxtLink>
            <span class="deal-crumb-sep">/</span>
            <span class="deal-crumb-current">{{ crumb }}</span>
          </nav>
        </div>
        <NuxtLink to="/tokens" class="deal-page-back">
          <i class="ri-arrow-left-line"></i> 返回通告列表
        </NuxtLink>
      </div>
    </header>

    <main class="deal-page-main">
      <!-- 加载失败（非 404/403，例如上游异常）：给可重试状态，不留整页空白 -->
      <div v-if="loadError" class="deal-page-state">
        <i class="ri-error-warning-line"></i>
        <p>{{ loadError }}</p>
        <div class="deal-page-state-actions">
          <button type="button" class="deal-page-btn" @click="refresh()">重试</button>
          <NuxtLink to="/tokens" class="deal-page-btn ghost">返回通告列表</NuxtLink>
        </div>
      </div>

      <!-- 正文：与列表页弹窗同一个组件，variant="page" 换成就地排版，
           并且由 SSR 预取载荷（initial / initialReviews）渲染首帧 -->
      <TokenDealDetail
        v-else
        :deal-id="dealId"
        variant="page"
        :initial="data"
        :initial-reviews="reviewsData"
        @edit="onEdit"
        @changed="refresh()"
      />

      <TokenDealEditor
        v-if="editorDeal"
        :deal="editorDeal"
        @close="editorDeal = null"
        @saved="onSaved"
      />

      <SiteFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import TokenDealDetail from '~/components/tokens/TokenDealDetail.vue'
import TokenDealEditor from '~/components/tokens/TokenDealEditor.vue'
import SiteFooter from '~/components/common/SiteFooter.vue'

/**
 * /tokens/<dealId>.html —— 通告详情的伪静态落地页
 *
 * 与旧的 `/tokens?deal=<id>` 的本质区别：**详情正文由服务端渲染进 HTML**。
 * 旧形态下 index.vue 只把 id 交给弹窗组件，内容由组件 onMounted 里 $fetch 拉取，
 * 爬虫拿到的 HTML 里没有任何通告内容（等于没做伪静态）。
 * 这里在 SSR 阶段就把 /api/token-deals/:id 与第一页评测取好，作为 initial 载荷
 * 传给同一个 TokenDealDetail 组件，首帧即正文；客户端 hydration 复用同一份 payload。
 *
 * 路由本身（`.html` 字面量后缀）由 nuxt.config.ts 的 pages:extend 改写，见那里的注释。
 */
definePageMeta({ layout: 'default' })

interface DealDetailPayload {
  deal: ITokenDealMeta
  // 下列几项直接透传给 TokenDealDetail 使用，页面不为它们做二次加工，
  // 这里保持宽松类型（真正的形状由 detail 组件与 /api/token-deals/:id 约定）
  verifications: any[]
  edits: any
  guest_review: any
  my_vote: string | null
  my_review: { rating: number; content: string } | null
}

interface ITokenDealMeta {
  id: string
  provider: string
  title: string
  url: string
  quota?: string
  models?: string[]
  status?: string
  note?: string
  note_html?: string
  nickname?: string
}

interface ReviewsPayload {
  reviews: { id: string; content: string }[]
  distribution: Record<number, number>
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

const route = useRoute()
const siteBaseUrl = (useRuntimeConfig().public.baseUrl as string) || 'https://hao.bx9y.com.cn'
/** 路由参数已由 `[\w-]+` 正则限定，这里再兜一层去掉可能的 .html 后缀（防御式，实测本不需要） */
const dealId = computed(() => decodeURIComponent(String(route.params.id ?? '')).replace(/\.html$/i, ''))

/**
 * SSR 取数 —— 关键点：**必须带上浏览器请求头（尤其 cookie）**。
 *
 * Nuxt 服务端对「相对 URL」的 fetch 会走 useRequestFetch()（= event.$fetch），
 * 把入站请求头（cookie / user-agent 等）代理给内部 API：
 *   - cookie：登录态 → is_owner / can_edit / my_vote / my_review / edits / guest_review；
 *     其中游客身份判重用的是服务端下发的第一方 cookie `favshub_visitor`（**不是 IP**），
 *     所以不转发 cookie 会拿到「另一个人」的视角。
 *   - user-agent：游客指纹 sha256(ip|ua) 的一半。
 * 不转发的话，服务端渲染出的是未登录视角，客户端 hydration 后又是登录视角，
 * 会出现内容闪烁与 hydration 不匹配告警。
 *
 * 这里显式写 useRequestFetch()（而不是依赖 useFetch 的内部行为）是为了让
 * 「cookie 必须带」这件事在代码里可见、可 review；
 * 等价的手写方式是 `headers: useRequestHeaders(['cookie'])`，但它只覆盖 cookie，
 * 漏掉 user-agent 会让游客指纹在 SSR 与客户端两侧不一致。
 */
const requestFetch = useRequestFetch()

const { data, error, refresh } = await useAsyncData(
  () => `token-deal-detail:${dealId.value}`,
  () => requestFetch<DealDetailPayload>(`/api/token-deals/${encodeURIComponent(dealId.value)}`),
  { server: true, lazy: false },
)

const { data: reviewsData } = await useAsyncData(
  () => `token-deal-detail-reviews:${dealId.value}`,
  () => requestFetch<ReviewsPayload>(
    `/api/token-deals/${encodeURIComponent(dealId.value)}/reviews`,
    { query: { page: 1, limit: 20 } },
  ),
  { server: true, lazy: false },
)

const statusCode = computed(() => Number((error.value as any)?.statusCode || (error.value as any)?.status || 0))

/**
 * 服务端把「不存在 / 无权访问」如实变成 4xx：爬虫不该把 404 的详情页当有效页面收录，
 * 也不能对所有人返回 200 的「不存在」页面（那等于软 404）。
 * 客户端导航时不抛错 —— 走下面的内联错误态，避免在应用内跳转时整页变错误页。
 */
if (import.meta.server && statusCode.value >= 400 && statusCode.value < 500) {
  throw createError({
    statusCode: statusCode.value,
    // 用 message 而非 statusMessage：h3 已提示 statusMessage 用于短状态文本、
    // 长文案会被 sanitize，中文长句应走 message
    message: statusCode.value === 404 ? '通告不存在或已失效' : '无权访问该通告',
    data: { error: (error.value as any)?.data?.error || '通告不存在或已失效' },
  })
}

const loadError = computed(() => {
  if (!error.value) return ''
  if (statusCode.value === 404) return '通告不存在或已失效'
  if (statusCode.value === 403) return '无权访问该通告'
  return (error.value as any)?.data?.error || '加载失败，请稍后重试'
})

const crumb = computed(() => {
  const deal = data.value?.deal
  if (!deal) return '通告详情'
  return `${deal.provider || ''} · ${deal.title || ''}`.replace(/^\s*·\s*/, '')
})

/** 分享/搜索结果里的摘要：优先用已消毒的 note_html 去标签，退化到额度 */
function summarize(deal: DealDetailPayload['deal'] | undefined): string {
  if (!deal) return ''
  const text = String(deal.note_html || deal.note || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  if (text) return text.slice(0, 150)
  const quota = String(deal.quota || '').trim()
  return quota ? `${deal.provider} 免费额度：${quota}` : `${deal.provider} 的免费额度通告，含接入地址、支持模型与社区实测评价。`
}

const pageTitle = computed(() => {
  const deal = data.value?.deal
  if (!deal) return 'Token 白嫖通告 — 免费 AI 额度时效情报'
  return `${deal.title} — ${deal.provider} Token 白嫖通告`
})

const canonicalUrl = computed(() => {
  return `${siteBaseUrl}/tokens/${encodeURIComponent(dealId.value)}.html`
})

// 分享封面：/tokens 全段统一用 Token 主题封面（1200x630），覆盖 layouts/default.vue 的全站默认图
const tokensOgImage = `${siteBaseUrl}/images/og-cover-tokens.png`
// 图片 alt 必须描述这张图本身，不能沿用全站 siteTitle（那描述的是首页封面）
const tokensOgImageAlt = computed(() => {
  const deal = data.value?.deal
  return deal
    ? `${deal.title} — ${deal.provider} 免费额度通告：可用与失效一眼看清`
    : 'Token 白嫖通告：哪家在发免费 Token、哪家已失效，一眼看清'
})

useHead({
  title: pageTitle,
  meta: [
    { name: 'description', content: computed(() => summarize(data.value?.deal)) },
    { property: 'og:type', content: 'article' },
    { property: 'og:title', content: pageTitle },
    { property: 'og:description', content: computed(() => summarize(data.value?.deal)) },
    { property: 'og:url', content: canonicalUrl },
    { property: 'og:image', content: tokensOgImage },
    { property: 'og:image:secure_url', content: tokensOgImage },
    { property: 'og:image:alt', content: tokensOgImageAlt },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: computed(() => summarize(data.value?.deal)) },
    { name: 'twitter:image', content: tokensOgImage },
    { name: 'twitter:image:alt', content: tokensOgImageAlt },
  ],
  link: [{ rel: 'canonical', href: canonicalUrl }],
})

const editorDeal = ref<any>(null)

function onEdit(deal: any) {
  editorDeal.value = deal
}

function onSaved(message: string) {
  editorDeal.value = null
  if (message) {
    // 与列表页一致的轻提示位置：编辑结果由编辑器自身提示，这里只保证数据刷新
  }
  refresh()
}
</script>

<style scoped>
.deal-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.deal-page-header {
  width: 100%;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.deal-page-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: nowrap;
}
.deal-page-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.deal-page-logo {
  display: flex;
  align-items: center;
  border-radius: 6px;
  text-decoration: none;
  transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.deal-page-logo:hover { opacity: 0.7; }
.deal-page-logo-img {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}
.deal-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
}
.deal-crumb-link {
  color: var(--text-tertiary);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.deal-crumb-link:hover { color: var(--primary); }
.deal-crumb-sep { color: var(--text-tertiary); opacity: 0.6; }
.deal-crumb-current {
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.deal-page-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.deal-page-back:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.deal-page-back:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.deal-page-main {
  flex: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 16px 32px;
}
.deal-page-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 64px 16px;
  color: var(--text-secondary);
  text-align: center;
}
.deal-page-state i {
  font-size: 28px;
  color: var(--text-tertiary);
}
.deal-page-state p { margin: 0; }
.deal-page-state-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}
.deal-page-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.deal-page-btn:hover { background: var(--primary-hover); }
.deal-page-btn.ghost {
  background: var(--surface-sunken);
  color: var(--text-secondary);
}
.deal-page-btn.ghost:hover { background: var(--surface-hover); color: var(--text-primary); }
</style>

<style>
/* ── tokens 模块弹窗共享 keyframes（全局，非 scoped）──
   详情页也会挂载 TokenShareSheet / TokenDealEditor / 游客评测等弹窗，
   它们各自的 scoped 样式引用的是这几个**全局**动画名，故必须在本路由上也定义。
   与 pages/tokens/index.vue 里的同名定义内容一致（全局动画名重复声明幂等，不冲突）。 */
@keyframes modal-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes modal-in {
  from { opacity: 0; transform: translateY(12px) scale(0.99); }
  to { opacity: 1; transform: none; }
}
@keyframes modal-spin {
  to { transform: rotate(360deg); }
}
</style>
