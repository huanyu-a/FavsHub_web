<template>
  <div>
    <header class="tokens-header">
      <div class="tokens-header-inner">
        <div class="tokens-header-left">
          <NuxtLink to="/" class="tokens-header-logo" title="返回主页">
            <img src="/images/logo.svg" alt="Logo" class="tokens-header-logo-img">
          </NuxtLink>
          <h1 class="tokens-header-title"><i class="ri-gift-2-line"></i> Token 白嫖通告</h1>
        </div>
        <nav class="tokens-header-nav">
          <NuxtLink to="/" class="tokens-header-link" title="主页">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span>主页</span>
          </NuxtLink>
          <NuxtLink to="/collections" class="tokens-header-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/><path d="M8 11h8"/></svg>
            <span>精选集</span>
          </NuxtLink>
          <NuxtLink to="/tokens" class="tokens-header-link active">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M19 12v3"/><path d="M5 12v3"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>
            <span>白嫖通告</span>
          </NuxtLink>
          <NuxtLink to="/prompts" class="tokens-header-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
            <span>提示词</span>
          </NuxtLink>
          <!-- 评测看板是服务器上的独立静态页（非 Nuxt 路由）→ 用原生 a 触发整页加载，避免 router 匹配失败 -->
          <a href="/tokens/eval/" class="tokens-header-link" title="Nexus 模型评测看板">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            <span>评测看板</span>
          </a>
        </nav>
      </div>
    </header>

    <div class="tokens-page">
      <section class="tokens-hero">
        <div class="hero-text">
          <h1 class="hero-title">Token 白嫖通告</h1>
          <p class="hero-sub">
            社区众包的免费 AI 额度情报：谁还能用、谁已经失效，由每一次投票与评测实时更新。共 {{ pagination.total }} 条通告。
          </p>
        </div>
        <div class="hero-toolbar">
          <div class="search-box">
            <i class="ri-search-line"></i>
            <input v-model="search" type="text" placeholder="搜索服务商、额度或模型..." @input="debouncedSearch">
          </div>
          <!-- 待我审核：作者审自己通告上的提案，管理员审全部 -->
          <button
            v-if="authStore.isLoggedIn"
            type="button"
            class="hero-review"
            title="查看待我审核的修改建议"
            @click="openReviewPanel"
          >
            <i class="ri-inbox-unarchive-line"></i> 待我审核
            <span v-if="reviewCount > 0" class="review-badge">{{ reviewCount }}</span>
          </button>
          <button type="button" class="hero-publish" @click="openEditor()">
            <i class="ri-add-line"></i> 发布通告
          </button>
        </div>
      </section>

      <TokenFilterBar
        v-model:sort="sort"
        v-model:quality="quality"
        v-model:source-tag="sourceTag"
      />

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-state">
        <i class="ri-loader-4-line spin"></i>
        <p>加载中...</p>
      </div>

      <!-- 空状态 -->
      <div v-else-if="deals.length === 0" class="empty-state">
        <i class="ri-inbox-line"></i>
        <p>{{ hasFilter ? '没有符合条件的通告' : '暂无通告' }}</p>
        <span>{{ hasFilter ? '试试放宽筛选条件' : '成为第一个分享免费额度的人吧' }}</span>
      </div>

      <!-- 卡片网格 -->
      <div v-else class="tokens-grid">
        <TokenDealCard v-for="d in deals" :key="d.id" :deal="d" @open="openDetail" />
      </div>

      <!-- 分页 -->
      <div v-if="pagination.totalPages > 1" class="pagination">
        <button :disabled="pagination.page <= 1" @click="prevPage">上一页</button>
        <span class="page-info">{{ pagination.page }} / {{ pagination.totalPages }}</span>
        <button :disabled="pagination.page >= pagination.totalPages" @click="nextPage">下一页</button>
      </div>

      <BackToTop />
    </div>

    <!-- 详情弹窗 -->
    <TokenDealDetail
      v-if="detailDeal"
      :deal-id="detailDeal.id"
      @close="closeDetail"
      @edit="onEditFromDetail"
      @changed="refresh"
    />

    <!-- 发布 / 编辑弹窗 -->
    <TokenDealEditor
      v-if="editorOpen"
      :deal="editorDeal"
      @close="editorOpen = false"
      @saved="onSaved"
    />

    <!-- 待我审核的修改建议面板 -->
    <TokenEditReviewPanel
      v-if="reviewPanelOpen"
      @close="reviewPanelOpen = false"
      @reviewed="loadReviewCount"
      @open-deal="onOpenDealFromPanel"
    />

    <!-- 轻提示 -->
    <Transition name="tokens-toast">
      <div v-if="toastMessage" class="tokens-toast">{{ toastMessage }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import TokenDealCard from '~/components/tokens/TokenDealCard.vue'
import TokenFilterBar from '~/components/tokens/TokenFilterBar.vue'
import TokenDealDetail from '~/components/tokens/TokenDealDetail.vue'
import TokenDealEditor from '~/components/tokens/TokenDealEditor.vue'
import TokenEditReviewPanel from '~/components/tokens/TokenEditReviewPanel.vue'
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ layout: 'default' })

interface ITokenDeal {
  id: string
  provider: string
  title: string
  url: string
  quota?: string
  models?: string[]
  region?: string
  quality?: string
  source_tag?: string
  expires_at?: number | null
  pinned?: number
  is_expired?: boolean
  vote_up?: number
  vote_down?: number
  rating_sum?: number
  rating_count?: number
}

interface IPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()

const _tokensBase = (useRuntimeConfig().public.baseUrl as string) || 'https://hao.bx9y.com.cn'
const tokensBaseUrl = computed(() => `${_tokensBase}/tokens`)

const tokensTitle = 'Token 白嫖通告 — 免费 AI 额度时效情报'
const tokensDesc = '社区众包的免费 AI Token 额度通告板：实时投票标记可用与失效，五档品质分级、来源标签、一键导入书签库。'
const tokensKw = '免费API,免费Token,AI额度白嫖,免费大模型,API中转,额度失效'

useHead({
  title: tokensTitle,
  meta: [
    { name: 'description', content: tokensDesc },
    { name: 'keywords', content: tokensKw },
    { property: 'og:site_name', content: 'FavsHub' },
    { property: 'og:title', content: tokensTitle },
    { property: 'og:description', content: tokensDesc },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: tokensBaseUrl },
    { property: 'og:locale', content: 'zh_CN' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: tokensTitle },
    { name: 'twitter:description', content: tokensDesc },
  ],
  link: [
    { rel: 'canonical', href: tokensBaseUrl },
  ],
})

const search = ref('')
const sort = ref('nexus')
const quality = ref('')
const sourceTag = ref('')
const page = ref(1)
const limit = 24

const detailDeal = ref<ITokenDeal | null>(null)
const editorOpen = ref(false)
const editorDeal = ref<ITokenDeal | null>(null)

// ── 待我审核的修改建议 ──
const reviewPanelOpen = ref(false)
const reviewCount = ref(0)

/** 拉取待审建议数量（用于入口角标）；未登录或接口不可用时静默归零 */
async function loadReviewCount() {
  if (!authStore.isLoggedIn) {
    reviewCount.value = 0
    return
  }
  try {
    const res = await $fetch<{ total: number }>('/api/token-deal-edits', {
      query: { limit: 1 },
      credentials: 'include',
    })
    reviewCount.value = res?.total || 0
  } catch {
    reviewCount.value = 0
  }
}

function openReviewPanel() {
  reviewPanelOpen.value = true
}

/** 面板里点了某条通告 → 关面板并打开该通告详情 */
function onOpenDealFromPanel(dealId: string) {
  reviewPanelOpen.value = false
  detailDeal.value = { id: dealId } as ITokenDeal
  syncDealQuery(dealId)
}

const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(text: string) {
  if (toastTimer) clearTimeout(toastTimer)
  toastMessage.value = text
  toastTimer = setTimeout(() => { toastMessage.value = '' }, 3000)
}

let searchTimeout: ReturnType<typeof setTimeout>

// 服务端预取 + 客户端复用，避免 SSR 空白闪烁
const { data, refresh, pending } = await useFetch<{ deals: ITokenDeal[]; pagination: IPagination }>('/api/token-deals', {
  query: { page, limit, sort, quality, source_tag: sourceTag, search },
  server: true,
  lazy: false,
  getCachedData: (key, nuxtApp) => nuxtApp.payload?.data?.[key],
})

const loading = computed(() => pending.value)
const deals = computed(() => data.value?.deals || [])
const pagination = computed(() => data.value?.pagination || { page: 1, limit, total: 0, totalPages: 1 })
const hasFilter = computed(() => !!(search.value || quality.value || sourceTag.value))

function debouncedSearch() {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => { page.value = 1; refresh() }, 300)
}

function prevPage() {
  if (page.value > 1) page.value--
}

function nextPage() {
  if (page.value < pagination.value.totalPages) page.value++
}

function openDetail(deal: ITokenDeal) {
  detailDeal.value = deal
  syncDealQuery(deal.id)
}

function closeDetail() {
  detailDeal.value = null
  if (route.query.deal) syncDealQuery(null)
}

/**
 * 详情弹窗与 ?deal= 查询参数双向同步：
 * 分享出去的 /tokens?deal=<id> 扫码/点开即还原弹窗，关闭时清掉参数保持地址干净。
 */
function syncDealQuery(id: string | null) {
  const query: Record<string, any> = { ...route.query }
  if (id) query.deal = id
  else delete query.deal
  router.replace({ query })
}

/** 未登录先引导登录，登录后回到本页并带上 openEditor 标记自动打开表单 */
function openEditor(deal: ITokenDeal | null = null) {
  if (!authStore.isLoggedIn) {
    router.push({ path: '/login', query: { redirect: '/tokens', action: 'publish' } })
    return
  }
  editorDeal.value = deal
  editorOpen.value = true
}

function onEditFromDetail(deal: ITokenDeal) {
  closeDetail()
  openEditor(deal)
}

function onSaved(message: string) {
  editorOpen.value = false
  editorDeal.value = null
  if (message) showToast(message)
  page.value = 1
  refresh()
}

// 翻页 / 筛选变化自动重新请求
watch([page, sort, quality, sourceTag], () => refresh())

// 从登录页跳回时自动展开发布表单；带 ?deal= 落地时自动打开对应详情弹窗
onMounted(() => {
  // 待审建议角标：不阻塞首屏，后台拉取
  loadReviewCount()

  if (route.query.action === 'publish' && authStore.isLoggedIn) {
    const next: Record<string, any> = { ...route.query }
    delete next.action
    openEditor()
    router.replace({ query: next })
    return
  }
  const sharedId = String(route.query.deal || '').trim()
  if (sharedId) {
    // 仅传 id，详情内容由弹窗自行拉取（未过审/不存在时由弹窗提示）
    detailDeal.value = { id: sharedId } as ITokenDeal
  }
})

onUnmounted(() => {
  clearTimeout(searchTimeout)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<style scoped>
.tokens-header {
  width: 100%;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.tokens-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  white-space: nowrap;
}
.tokens-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tokens-header-logo {
  display: flex;
  align-items: center;
  text-decoration: none;
  transition: opacity 0.15s;
}
.tokens-header-logo:hover { opacity: 0.7; }
.tokens-header-logo-img {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}
.tokens-header-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.tokens-header-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: nowrap;
}
.tokens-header-link {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
}
.tokens-header-link svg {
  width: 15px;
  height: 15px;
  opacity: 0.7;
}
.tokens-header-link:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.tokens-header-link:hover svg { opacity: 1; }
.tokens-header-link.active {
  color: var(--accent-blue, #3b82f6);
  background: var(--accent-blue-light, rgba(59, 130, 246, 0.08));
}
.tokens-header-link.active svg { opacity: 1; }

.tokens-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

/* ── 主色横幅：页面视觉锚点 ── */
.tokens-hero {
  background: var(--primary, #10b981);
  border-radius: 20px;
  padding: 34px 32px 30px;
  margin-bottom: 20px;
  color: var(--text-inverse, #fff);
}
.hero-title {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.022em;
  color: var(--text-inverse, #fff);
}
.hero-sub {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  max-width: 640px;
  color: color-mix(in srgb, var(--text-inverse, #fff) 80%, transparent);
}
.hero-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 24px;
  flex-wrap: wrap;
}
.hero-toolbar .search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border: none;
  border-radius: 12px;
  background: var(--surface-raised, #fff);
  flex: 1;
  min-width: 220px;
  transition: box-shadow 0.18s;
}
.hero-toolbar .search-box i { color: var(--text-tertiary); font-size: 16px; transition: color 0.18s; }
.hero-toolbar .search-box:focus-within {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-inverse, #fff) 45%, transparent);
}
.hero-toolbar .search-box:focus-within i { color: var(--primary); }
.hero-toolbar .search-box input {
  border: none;
  background: none;
  outline: none;
  font-size: 13.5px;
  width: 100%;
  color: var(--text-primary);
}
.hero-toolbar .search-box input::placeholder { color: var(--text-tertiary); }

.hero-publish {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 10px 18px;
  border: none;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: var(--surface-raised, #fff);
  color: var(--primary, #10b981);
  transition: transform 0.18s, box-shadow 0.18s;
}
.hero-publish:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px -4px rgba(16, 24, 40, 0.28);
}
.hero-publish i { font-size: 15px; }

/* 待我审核入口：与「发布通告」同排，视觉弱一档以保持主次 */
.hero-review {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 10px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.16);
  color: var(--surface-raised, #fff);
  transition: background 0.18s, transform 0.18s;
}
.hero-review:hover {
  background: rgba(255, 255, 255, 0.26);
  transform: translateY(-1px);
}
.hero-review i { font-size: 15px; }
.review-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: #ef4444;
}

.tokens-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  color: var(--text-tertiary, #9ca3af);
}
.empty-state i {
  font-size: 36px;
  margin-bottom: 10px;
}
.empty-state p {
  font-size: 14px;
  font-weight: 500;
  margin: 0;
}
.empty-state span {
  font-size: 12px;
  margin-top: 4px;
}
.spin {
  font-size: 22px;
  animation: tokens-spin 1s linear infinite;
}
@keyframes tokens-spin {
  to { transform: rotate(360deg); }
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}
.pagination button {
  padding: 7px 18px;
  border: none;
  border-radius: 10px;
  background: var(--surface-raised, #fff);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-size: 12.5px;
  color: var(--text-secondary);
  transition: color 0.18s, transform 0.18s, box-shadow 0.18s;
}
.pagination button:not(:disabled):hover {
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.page-info {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  font-variant-numeric: tabular-nums;
}

/* ── 轻提示（发布结果 / 审核状态） ── */
.tokens-toast {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 1400;
  padding: 9px 18px;
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--text-inverse);
  background: var(--text-primary);
  box-shadow: var(--shadow-lg);
  white-space: nowrap;
}
.tokens-toast-enter-active,
.tokens-toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.tokens-toast-enter-from,
.tokens-toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* ── 移动端适配 ── */
@media (max-width: 1024px) {
  .tokens-page {
    padding: 72px 16px 96px;
  }
}
@media (max-width: 768px) {
  .tokens-header {
    display: none;
  }
  .tokens-page {
    padding: 68px 12px 96px;
  }
  .tokens-hero {
    padding: 24px 20px 22px;
    border-radius: 16px;
  }
  .hero-title { font-size: 23px; }
  .hero-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .hero-toolbar .search-box {
    min-width: 0;
    width: 100%;
  }
  .hero-publish {
    justify-content: center;
  }
  .hero-review {
    justify-content: center;
  }
  .tokens-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 480px) {
  .tokens-page {
    padding: 60px 10px 96px;
  }
  .tokens-header-title {
    font-size: 14px;
  }
}
</style>
