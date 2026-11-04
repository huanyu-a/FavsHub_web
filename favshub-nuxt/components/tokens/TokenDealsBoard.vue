<template>
  <div>
    <!--
      模块页头（2026-11-04 从 pages/tokens/index.vue 抽出，供 /tokens、/tokens/api、
      /tokens/server、/tokens/domain 四个列表页共用）。

      标题用 <span> 而非 <h1>：分类落地页的 <h1> 应属于页面自己的 hero 标题
      （「免费 API / 模型」等）。原来这里和 hero 各有一个 <h1>，同一页出现两个
      一级标题，对分类落地页的收录不利。样式与原来的 h1 完全一致。
    -->
    <header class="tokens-header">
      <div class="tokens-header-inner">
        <div class="tokens-header-left">
          <NuxtLink to="/" class="tokens-header-logo" title="返回主页">
            <img src="/images/logo.svg" alt="FavsHub" class="tokens-header-logo-img">
          </NuxtLink>
          <span class="tokens-header-title"><i class="ri-gift-2-line"></i> Token 白嫖通告</span>
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
          <NuxtLink to="/tokens" class="tokens-header-link" :class="{ active: !fixedCategory }">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M19 12v3"/><path d="M5 12v3"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>
            <span>白嫖通告</span>
          </NuxtLink>
          <!-- 精选对比（2026-11-04）：已并入 /tokens 页底部内嵌，**顶部导航不再列出**。
              理由：它在导航里占了一个和「白嫖通告」同级的入口，层级过高；
              而且现在列表页下面就有对比表，不必再跳一次。
              /tokens/compare 路由仍保留（老链接、外链、sitemap 收录都指向它），
              入口在 /tokens 对比区的「单独打开对比页」链接。 -->
          <NuxtLink to="/tokens/keys" class="tokens-header-link" title="福利 Key">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <span>福利 Key</span>
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
      <!-- 面包屑（2026-11-04 新增）──
           用户报「/tokens/api 无法回到 /tokens 页」：原来只有顶部导航与页脚链接，
           缺少面包屑这种「明确上一级」的入口。分类页显示 首页 / 白嫖通告 / 分类名，
           /tokens 本身只显示 首页 / 白嫖通告。
           用 <nav> + aria-label，并给当前页加 aria-current，读屏能识别层级。 -->
      <nav class="tokens-crumb" aria-label="面包屑导航">
        <NuxtLink to="/" class="crumb-link">首页</NuxtLink>
        <span class="crumb-sep" aria-hidden="true">›</span>
        <template v-if="fixedCategory">
          <NuxtLink to="/tokens" class="crumb-link">白嫖通告</NuxtLink>
          <span class="crumb-sep" aria-hidden="true">›</span>
          <span class="crumb-current" aria-current="page">{{ title }}</span>
        </template>
        <span v-else class="crumb-current" aria-current="page">白嫖通告</span>
      </nav>

      <section class="tokens-hero">
        <div class="hero-text">
          <h1 class="hero-title">{{ heroTitle }}</h1>
          <p class="hero-sub">{{ heroSub }}</p>
          <p class="hero-count">共 {{ pagination.total }} 条通告</p>
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

      <!-- 分类导语：分类落地页用它交代「这一页收的是什么、怎么用」 -->
      <p v-if="intro" class="board-intro">{{ intro }}</p>

      <!-- 页面级插槽：/tokens 首页的分类导航卡挂在这里（hero 之下、筛选条之上） -->
      <slot name="after-hero" />

      <TokenFilterBar
        v-model:sort="sort"
        v-model:quality="quality"
        v-model:source-tag="sourceTag"
        v-model:category="category"
        v-model:verify-state="verifyState"
        v-model:fav-only="favOnly"
        :lock-category="!!fixedCategory"
      />

      <!-- 加载状态：骨架屏 -->
      <div v-if="loading" class="skeleton-grid" aria-hidden="true">
        <div v-for="i in 6" :key="i" class="skeleton-card">
          <div class="sk-row">
            <div class="sk sk-avatar"></div>
            <div class="sk sk-quality"></div>
          </div>
          <div class="sk sk-line w-55"></div>
          <div class="sk sk-quota"></div>
          <div class="sk-row">
            <div class="sk sk-chip"></div>
            <div class="sk sk-chip"></div>
            <div class="sk sk-chip"></div>
          </div>
          <div class="sk sk-line w-40 sk-foot"></div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="visibleDeals.length === 0" class="empty-state">
        <i :class="emptyIcon"></i>
        <p>{{ emptyTitle }}</p>
        <span>{{ emptyHint }}</span>
      </div>

      <!-- 卡片网格 -->
      <div v-else class="tokens-grid">
        <TokenDealCard v-for="d in visibleDeals" :key="d.id" :deal="d" @open="openDetail" />
      </div>

      <!-- 分页 -->
      <div v-if="pagination.totalPages > 1" class="pagination">
        <button :disabled="pagination.page <= 1" @click="prevPage">上一页</button>
        <span class="page-info">{{ pagination.page }} / {{ pagination.totalPages }}</span>
        <button :disabled="pagination.page >= pagination.totalPages" @click="nextPage">下一页</button>
      </div>

      <!-- 分类 FAQ：可被搜索引擎收录的问答块，内容由各分类页提供。
           GEO（2026-11-04）：改用 `open` 默认展开。折叠状态下答案不在可见文本里，
           搜索与 AI 抓取只能拿到问题；展开后整段问答都可被索引。
           语义仍是 <details>，读屏与无 JS 场景不受影响。 -->
      <section v-if="faq && faq.length" class="board-faq">
        <h2 class="faq-heading">{{ faqTitle }}</h2>
        <details v-for="(item, i) in faq" :key="i" class="faq-item" open>
          <summary class="faq-q">{{ item.q }}</summary>
          <p class="faq-a">{{ item.a }}</p>
        </details>
      </section>
    </div>

    <!-- 详情弹窗（列表页保留原有弹窗交互：点击卡片就地展开，地址栏不落查询参数） -->
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

/**
 * 白嫖通告列表主体（2026-11-04 从 pages/tokens/index.vue 抽出）
 *
 * 四个列表页共用它：
 *   /tokens            —— fixedCategory 为空，全部分类 + 分类导航卡（走 after-hero 插槽）
 *   /tokens/api        —— fixedCategory="token"（API 额度）
 *   /tokens/server     —— fixedCategory="cloud"（免费云服务器）
 *   /tokens/domain     —— fixedCategory="domain"（免费域名）
 *   /tokens/client     —— fixedCategory="client"（客户端额度，2026-11-04 补）
 *
 * 关闭详情弹窗、编辑回填、刷新逻辑与抽取前保持完全一致。
 */
const props = withDefaults(defineProps<{
  /** 非空 → 锁死分类：请求固定带 category，筛选条的分类下拉隐藏 */
  fixedCategory?: '' | 'token' | 'cloud' | 'domain' | 'client'
  /** 空 → 用默认标题「Token 白嫖通告」 */
  title?: string
  /** 空 → 用默认副文案（条数始终另起一行展示，不依赖这里） */
  subtitle?: string
  /** hero 下方导语；空则不渲染该行 */
  intro?: string
  /** 页面底部 FAQ；空数组则不渲染整块 */
  faq?: Array<{ q: string; a: string }>
  /** FAQ 区块标题 */
  faqTitle?: string
}>(), {
  fixedCategory: '',
  title: '',
  subtitle: '',
  intro: '',
  faq: () => [],
  faqTitle: '常见问题',
})

interface ITokenDeal {
  id: string
  provider: string
  title: string
  url: string
  quota?: string
  /** 一句话摘要（2026-11-04 服务端新增列） */
  summary?: string
  models?: string[]
  region?: string
  quality?: string
  source_tag?: string
  category?: string
  expires_at?: number | null
  pinned?: number
  /** 1 = 进「精选对比」 */
  featured?: number
  is_expired?: boolean
  vote_up?: number
  vote_down?: number
  rating_sum?: number
  rating_count?: number
  // 人工核验时间轴（2026-10-20）
  verified_at?: number
  verify_age_days?: number
  verify_stale?: boolean
  verify_note?: string
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

const search = ref('')
/**
 * 默认排序（2026-10-30 需求：「/tokens 默认按最新排序」）。
 *
 * 原来是 `nexus`（Nexus 实测优先），而列表页**始终**把这个值作为 `sort` 查询参数发给
 * `/api/token-deals`，所以服务端默认值改不改都不影响页面首屏 —— 页面侧改这里就够了。
 * 「Nexus 实测」仍是排序条上的一个可选项，用户点了就切回去。
 */
const sort = ref('latest')
const quality = ref('')
const sourceTag = ref('')
const category = ref('')
/** 核实状态：'' 全部 | 'verified' 近期已核实 | 'stale' 待复核（替代原来的 stale 布尔 chip） */
const verifyState = ref('')
/** 只看收藏：纯本地过滤，不进请求（收藏存在浏览器 localStorage） */
const favOnly = ref(false)
const page = ref(1)
const limit = 24

/** 分类落地页锁死分类；普通列表页用户自己选 */
const effectiveCategory = computed(() => props.fixedCategory || category.value)

const heroTitle = computed(() => props.title || 'Token 白嫖通告')
const heroSub = computed(() => props.subtitle
  || '社区众包的免费 AI 额度情报：谁还能用、谁已经失效，由每一次投票与评测实时更新。')

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
}

const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(text: string) {
  if (toastTimer) clearTimeout(toastTimer)
  toastMessage.value = text
  toastTimer = setTimeout(() => { toastMessage.value = '' }, 3000)
}

let searchTimeout: ReturnType<typeof setTimeout>

/**
 * 请求参数。
 *
 * `verified` / `featured` / `exclude` 是 W1（后端）本轮新增的参数：
 * 服务端未就绪时未知参数会被忽略（等价于不加该条件），前端不会因此报错。
 * `verified=0` 而不是省略，是为了让参数形态恒定 —— 服务端只认 `'1'`。
 */
const boardQuery = computed(() => ({
  page: page.value,
  limit,
  sort: sort.value,
  quality: quality.value,
  source_tag: sourceTag.value,
  category: effectiveCategory.value,
  search: search.value,
  stale: verifyState.value === 'stale',
  verified: verifyState.value === 'verified' ? 1 : 0,
}))

// 服务端预取 + 客户端复用，避免 SSR 空白闪烁
const { data, refresh, pending } = await useFetch<{ deals: ITokenDeal[]; pagination: IPagination }>('/api/token-deals', {
  query: boardQuery,
  server: true,
  lazy: false,
  getCachedData: (key, nuxtApp) => nuxtApp.payload?.data?.[key],
})

const loading = computed(() => pending.value)
const deals = computed(() => data.value?.deals || [])
const pagination = computed(() => data.value?.pagination || { page: 1, limit, total: 0, totalPages: 1 })

// ── 收藏（本地过滤，不新增 API）──
const { favorites } = useDealFavorites()

/** 当前页要渲染的卡片：开了「只看收藏」就在本页结果里取交集 */
const visibleDeals = computed(() => {
  if (!favOnly.value) return deals.value
  const set = new Set(favorites.value)
  return deals.value.filter(d => set.has(d.id))
})

const hasFilter = computed(() => !!(
  search.value || quality.value || sourceTag.value || category.value
  || verifyState.value || favOnly.value
))

// 三种空状态文案：只看收藏 / 有筛选 / 真的没数据
const emptyTitle = computed(() => {
  if (favOnly.value && deals.value.length > 0) return '本页没有你收藏的通告'
  return hasFilter.value ? '没有符合条件的通告' : '暂无通告'
})
const emptyHint = computed(() => {
  if (favOnly.value && deals.value.length > 0) return '取消「只看收藏」即可查看全部通告'
  return hasFilter.value ? '试试放宽筛选条件' : '成为第一个分享免费额度的人吧'
})
const emptyIcon = computed(() => (favOnly.value ? 'ri-star-line' : 'ri-inbox-line'))

function debouncedSearch() {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => reloadFirstPage(), 300)
}

function prevPage() {
  if (page.value > 1) page.value--
}

function nextPage() {
  if (page.value < pagination.value.totalPages) page.value++
}

function openDetail(deal: ITokenDeal) {
  detailDeal.value = deal
}

/**
 * 关闭详情：只关弹窗。
 *
 * 这里**不再**同步 `?deal=` 查询参数（旧实现用 syncDealQuery 双向同步）：
 * 详情地址已改为伪静态路径 `/tokens/<id>.html`，弹窗就地展开时地址栏保持
 * `/tokens` 干净；老分享链接（`/tokens?deal=<id>`）由
 * server/middleware/legacy-detail-redirect.ts 在服务端 301 到新的落地页。
 */
function closeDetail() {
  detailDeal.value = null
}

/**
 * 打开发布 / 编辑表单。
 * 游客可直接发布（走游客通道，同样进入管理员审核）；
 * 编辑通告仍需登录（作者本人或管理员），未登录时先引导登录。
 */
function openEditor(deal: ITokenDeal | null = null) {
  if (!authStore.isLoggedIn && deal) {
    router.push({ path: '/login', query: { redirect: route.path || '/tokens', action: 'publish' } })
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
  reloadFirstPage()
}

// 筛选变化 → 回到第 1 页（页码本身绝不能被回置：翻页只靠下面的 watch 重新请求）
// favOnly 不在名单里 —— 它是本地过滤，不该触发重新请求
watch([sort, quality, sourceTag, category, verifyState], () => {
  if (page.value !== 1) page.value = 1
})
// 翻页 / 筛选变化 → 重新请求
watch([page, sort, quality, sourceTag, category, verifyState], () => refresh())

/** 从第 1 页重新加载：已在第 1 页时直接请求，否则改页码交给上面的 watch（避免重复请求） */
function reloadFirstPage() {
  if (page.value !== 1) page.value = 1
  else refresh()
}

onMounted(() => {
  // 待审建议角标：不阻塞首屏，后台拉取
  loadReviewCount()

  // 从登录页跳回时自动展开发布表单
  if (route.query.action === 'publish' && authStore.isLoggedIn) {
    const next: Record<string, any> = { ...route.query }
    delete next.action
    openEditor()
    router.replace({ query: next })
  }
})

onUnmounted(() => {
  clearTimeout(searchTimeout)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<style>
/* ── tokens 模块共享（全局，非 scoped）──
   4 个弹窗组件（详情 / 编辑 / 审核 / 分享）原先各自复制一套 backdrop fade、
   modal rise、spin keyframes，现合并为一份全局定义统一引用。
   本组件是 /tokens、/tokens/api、/tokens/server、/tokens/domain 四个列表页的
   共同宿主，因此由它承载这份定义（/tokens/[id].vue 详情页有自己的同名定义）。 */
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
  border-radius: 6px;
  transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tokens-header-logo:hover { opacity: 0.7; }
.tokens-header-logo:active { opacity: 0.6; }
.tokens-header-logo:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
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
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
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
.tokens-header-link:active { background: var(--surface-active); }
.tokens-header-link:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.tokens-header-link.active {
  color: var(--primary);
  background: var(--primary-light);
}
.tokens-header-link.active svg { opacity: 1; }

.tokens-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

/* ── 面包屑（2026-11-04）：与 .tokens-page 的 24px 内边距对齐，
      与 hero 之间留 10px，避免和标题贴在一起 ── */
.tokens-crumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
  margin-bottom: 10px;
}
.tokens-crumb .crumb-link {
  color: var(--text-muted);
  text-decoration: none;
  transition: color .15s;
}
.tokens-crumb .crumb-link:hover { color: var(--primary); }
.tokens-crumb .crumb-link:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 3px;
}
.tokens-crumb .crumb-sep { color: var(--border-strong); user-select: none; }
.tokens-crumb .crumb-current { color: var(--text); font-weight: 500; }

/* ── 克制的中性面板：主题色仅作强调（焦点环、主按钮），不再用满屏主色大色块 ── */
/* 紧凑页头：左标题+副文、右搜索+操作，一行放下（窄屏自动换行） */
.tokens-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 24px;
  flex-wrap: wrap;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  margin-bottom: 20px;
}
.hero-text {
  flex: 1 1 320px;
  min-width: 0;
}
.hero-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}
.hero-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  max-width: 560px;
  color: var(--text-secondary);
}
.hero-count {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.hero-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 0;
  flex-wrap: wrap;
  flex: 0 1 auto;
  min-width: 0;
}
.hero-toolbar .search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  flex: 1 1 240px;
  min-width: 220px;
  max-width: 420px;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
@media (max-width: 768px) {
  .tokens-hero {
    flex-direction: column;
    align-items: stretch;
  }
  /* 列方向下 flex-basis 的语义由宽度变为高度，必须重置，否则 hero 被撑满一屏 */
  .hero-text { flex: 0 0 auto; }
  .hero-toolbar .search-box {
    max-width: none;
    flex: 1 1 100%;
    min-width: 0;
  }
}
.hero-toolbar .search-box i { color: var(--text-tertiary); font-size: 16px; transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
.hero-toolbar .search-box:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-light);
}
.hero-toolbar .search-box:focus-within i { color: var(--primary); }
.hero-toolbar .search-box input {
  border: none;
  background: none;
  outline: none;
  font-size: 13px;
  width: 100%;
  color: var(--text-primary);
}
.hero-toolbar .search-box input::placeholder { color: var(--text-tertiary); }

.hero-publish {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 16px;
  border: 0.5px solid var(--primary);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: var(--primary);
  color: var(--text-inverse);
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.hero-publish:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
  box-shadow: var(--shadow-sm);
}
.hero-publish:active { background: var(--primary-dark); border-color: var(--primary-dark); }
.hero-publish:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.hero-publish i { font-size: 15px; }

/* 待我审核入口：与「发布通告」同排，视觉弱一档以保持主次 */
.hero-review {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 16px;
  border-radius: 10px;
  border: 0.5px solid var(--border);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: var(--surface-raised);
  color: var(--text-secondary);
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.hero-review:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
  border-color: var(--border-focus);
}
.hero-review:active { background: var(--surface-active); }
.hero-review:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.hero-review i { font-size: 15px; }
.review-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-inverse);
  background: var(--danger);
}

/* ── 分类导语：分类落地页的「这一段收的是什么」说明，供收录与第一眼理解 ── */
.board-intro {
  margin: 0 0 4px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  max-width: 860px;
}

.tokens-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}

/* ── 骨架屏 ── */
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}
.skeleton-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
}
.sk {
  border-radius: 6px;
  background: linear-gradient(90deg, var(--surface-sunken) 25%, var(--surface-hover) 50%, var(--surface-sunken) 75%);
  background-size: 200% 100%;
  animation: tokens-sk-shimmer 1.4s ease-in-out infinite;
}
.sk-row { display: flex; align-items: center; gap: 8px; }
.sk-avatar { width: 28px; height: 28px; border-radius: 6px; }
.sk-quality { width: 52px; height: 20px; border-radius: 6px; margin-left: auto; }
.sk-line { height: 12px; }
.sk-line.w-55 { width: 55%; }
.sk-line.w-40 { width: 40%; }
.sk-quota { height: 52px; border-radius: 10px; }
.sk-chip { width: 76px; height: 22px; border-radius: 6px; }
.sk-foot { margin-top: 2px; }
@keyframes tokens-sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── 空状态 ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 20px;
  color: var(--text-tertiary);
  background: var(--surface-raised);
  border: 1px dashed var(--border);
  border-radius: 14px;
  margin-bottom: 28px;
}
.empty-state i {
  font-size: 36px;
  margin-bottom: 8px;
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

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.pagination button {
  padding: 8px 16px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.pagination button:not(:disabled):hover {
  color: var(--primary);
  background: var(--surface-hover);
  box-shadow: var(--shadow-md);
}
.pagination button:not(:disabled):active { background: var(--surface-active); }
.pagination button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.page-info {
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* ── 分类 FAQ（可收录的问答块） ── */
.board-faq {
  margin: 8px 0 28px;
  padding: 20px 24px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
}
.faq-heading {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.faq-item {
  border-top: 0.5px solid var(--divider);
}
.faq-item:first-of-type { border-top: none; }
.faq-q {
  padding: 10px 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.faq-q::-webkit-details-marker { display: none; }
/* 自绘三角：<summary> 的默认 marker 在各浏览器表现不一致 */
.faq-q::before {
  content: '';
  flex-shrink: 0;
  width: 0;
  height: 0;
  border-left: 5px solid var(--text-tertiary);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.faq-item[open] .faq-q::before { transform: rotate(90deg); }
.faq-q:hover { color: var(--primary); }
.faq-q:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 4px;
}
.faq-a {
  margin: 0 0 12px;
  padding-left: 11px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}

/* ── 轻提示（发布结果 / 审核状态） ── */
.tokens-toast {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 1400;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 13px;
  color: var(--text-inverse);
  background: var(--text-primary);
  box-shadow: var(--shadow-lg);
  white-space: nowrap;
}
.tokens-toast-enter-active,
.tokens-toast-leave-active { transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1), transform 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
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
    padding: 24px 20px;
    border-radius: 14px;
  }
  .hero-title { font-size: 24px; }
  /* 工具栏保持基础 row+wrap：搜索框独占一行，「待我审核」「发布通告」平分一行 */
  .hero-toolbar .search-box {
    min-width: 0;
    width: 100%;
  }
  .hero-publish {
    flex: 1 1 0;
    justify-content: center;
  }
  .hero-review {
    flex: 1 1 0;
    justify-content: center;
  }
  .tokens-grid {
    grid-template-columns: 1fr;
  }
  .skeleton-grid {
    grid-template-columns: 1fr;
  }
  .board-faq {
    padding: 16px 18px;
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
