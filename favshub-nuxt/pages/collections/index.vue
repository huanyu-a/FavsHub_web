<template>
  <div>
    <header class="collections-header">
      <div class="collections-header-inner">
        <div class="collections-header-left">
          <NuxtLink to="/" class="collections-header-logo" title="返回主页">
            <img src="/images/logo.svg" alt="Logo" class="collections-header-logo-img">
          </NuxtLink>
          <h1 class="collections-header-title"><i class="ri-book-2-line"></i> 精选集市场</h1>
        </div>
        <nav class="collections-header-nav">
          <NuxtLink to="/" class="collections-header-link" title="主页">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span>主页</span>
          </NuxtLink>
          <NuxtLink to="/collections" class="collections-header-link active">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/><path d="M8 11h8"/></svg>
            <span>精选集</span>
          </NuxtLink>
          <NuxtLink to="/tokens" class="collections-header-link" title="Token 白嫖通告">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M19 12v3"/><path d="M5 12v3"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>
            <span>白嫖通告</span>
          </NuxtLink>
          <NuxtLink to="/tokens/keys" class="collections-header-link" title="福利 Key">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <span>福利 Key</span>
          </NuxtLink>
          <NuxtLink to="/prompts" class="collections-header-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
            <span>提示词</span>
          </NuxtLink>
          <!-- 评测看板是服务器上的独立静态页（非 Nuxt 路由）→ 用原生 a 触发整页加载，避免 router 匹配失败 -->
          <a href="/tokens/eval/" class="collections-header-link" title="Nexus 模型评测看板">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            <span>评测看板</span>
          </a>
        </nav>
      </div>
    </header>
    <div class="collections-page">
      <section class="market-hero">
        <div class="hero-text">
          <h1 class="hero-title">精选集市场</h1>
          <p class="hero-sub">浏览社区精选的主题书签集，一键导入你的书库。共 {{ pagination.total }} 个精选集。</p>
        </div>
        <div class="hero-toolbar">
          <div class="search-box">
            <i class="ri-search-line"></i>
            <input v-model="search" type="text" placeholder="搜索精选集..." @input="debouncedSearch">
          </div>
          <div class="sort-tabs">
            <button :class="{ active: sort === 'official' }" @click="sort = 'official'">官方推荐</button>
            <button :class="{ active: sort === 'hot' }" @click="sort = 'hot'">热门</button>
            <button :class="{ active: sort === 'newest' }" @click="sort = 'newest'">最新</button>
          </div>
        </div>
      </section>

    <!-- 加载状态：骨架屏 -->
    <div v-if="loading" class="skeleton-grid" aria-hidden="true">
      <div v-for="i in 6" :key="i" class="skeleton-card">
        <div class="sk-row">
          <div class="sk sk-icon"></div>
          <div class="sk sk-badge"></div>
        </div>
        <div class="sk sk-line w-60"></div>
        <div class="sk sk-line w-90"></div>
        <div class="sk sk-line w-40"></div>
        <div class="sk-row sk-actions">
          <div class="sk sk-btn"></div>
          <div class="sk sk-btn sk-btn-wide"></div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="collections.length === 0" class="empty-state">
      <i class="ri-inbox-line"></i>
      <p>{{ search ? '没有找到匹配的精选集' : '暂无精选集' }}</p>
      <span>{{ search ? '换个关键词试试' : '成为第一个创建精选集的人吧' }}</span>
    </div>

    <!-- 卡片网格 -->
    <div v-else class="collections-grid">
      <CollectionCard v-for="c in collections" :key="c.id" :collection="c" />
    </div>

    <!-- 分页 -->
    <div v-if="pagination.totalPages > 1" class="pagination">
      <button :disabled="pagination.page <= 1" @click="prevPage">上一页</button>
      <span class="page-info">{{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button :disabled="pagination.page >= pagination.totalPages" @click="nextPage">下一页</button>
    </div>
    <BackToTop />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, watch } from 'vue'
import CollectionCard from '~/components/collections/CollectionCard.vue'
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ layout: 'default' })

// SEO meta tags for collections market page
const _collectionsBase = (useRuntimeConfig().public.baseUrl as string) || 'https://hao.bx9y.com.cn'
const collectionsBaseUrl = computed(() => `${_collectionsBase}/collections`)

const { data: collTdk } = await useFetch('/api/tdk/collections', {
  server: true,
  lazy: false,
  getCachedData: (key, nuxtApp) => nuxtApp.payload?.data?.[key],
})

const collTitle = computed(() => collTdk.value?.collectionsTitle || '网址导航精选集')
const collDesc = computed(() => collTdk.value?.collectionsDescription || '')
const collKw = computed(() => collTdk.value?.collectionsKeywords || '')

useHead({
  title: collTitle,
  meta: [
    { name: 'description', content: collDesc },
    { name: 'keywords', content: collKw },
    // Open Graph
    { property: 'og:site_name', content: 'FavsHub' },
    { property: 'og:title', content: computed(() => `FavsHub ${collTitle.value} — 各行各业工具导航一键导入`) },
    { property: 'og:description', content: collDesc },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: collectionsBaseUrl },
    { property: 'og:locale', content: 'zh_CN' },
    // Twitter Card
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: computed(() => `FavsHub ${collTitle.value} — 各行各业工具导航一键导入`) },
    { name: 'twitter:description', content: collDesc }
  ],
  link: [
    { rel: 'canonical', href: collectionsBaseUrl },
  ],
})

interface ICollection {
  id: string
  name: string
  description: string
  icon: string
  is_public: number
  is_official: number
  bookmark_count: number
  created_at: number
  updated_at?: number
  username?: string
}

interface IPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

const search = ref('')
const sort = ref('official')
const page = ref(1)
const limit = 20

let searchTimeout: ReturnType<typeof setTimeout>

// 服务端预取 + 客户端复用，避免 SSR 空白闪烁
const { data, refresh, pending } = await useFetch<{ collections: ICollection[]; pagination: IPagination }>('/api/collections', {
  query: { page, limit, sort, search },
  server: true,
  lazy: false,
  getCachedData: (key, nuxtApp) => nuxtApp.payload?.data?.[key],
})

const loading = computed(() => pending.value)

const collections = computed(() => data.value?.collections || [])
const pagination = computed(() => data.value?.pagination || { page: 1, limit, total: 0, totalPages: 1 })

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

// 翻页时自动重新请求
watch([page, sort], () => refresh())

onUnmounted(() => {
  clearTimeout(searchTimeout)
})
</script>

<style scoped>
/* collections-header 样式已提取至 main-bundle.css（与 [id].vue 共享） */
/* ── 紧凑页头：左标题+副文、右搜索+排序，与 tokens 页 hero 同款 ── */
.market-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 24px;
  flex-wrap: wrap;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg, 14px);
  padding: 20px 24px;
  margin-bottom: 24px;
  color: var(--text-primary);
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
  color: var(--text-secondary);
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
  gap: 10px;
  padding: 8px 16px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  flex: 1 1 240px;
  min-width: 220px;
  max-width: 380px;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.hero-toolbar .search-box i { color: var(--text-tertiary); font-size: 16px; transition: color 180ms cubic-bezier(0.22, 1, 0.36, 1); }
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
.hero-toolbar .sort-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-hover);
  border-radius: 10px;
}
.hero-toolbar .sort-tabs button {
  padding: 7px 16px;
  font-size: 12px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: background-color 180ms cubic-bezier(0.22, 1, 0.36, 1),
              color 180ms cubic-bezier(0.22, 1, 0.36, 1),
              transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.hero-toolbar .sort-tabs button:hover { background: var(--surface-active); }
.hero-toolbar .sort-tabs button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.hero-toolbar .sort-tabs button:active { transform: scale(0.98); }
.hero-toolbar .sort-tabs button.active {
  background: var(--surface-raised);
  color: var(--primary);
  font-weight: 600;
}
@media (max-width: 768px) {
  .market-hero {
    flex-direction: column;
    align-items: stretch;
  }
  /* 列方向下 flex-basis 的语义由宽度变为高度，必须重置，否则 hero 被撑满一屏 */
  .hero-text { flex: 0 0 auto; }
  .hero-toolbar .search-box {
    max-width: none;
    flex: 0 0 auto;
    min-width: 0;
  }
}
.collections-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}
.collections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 28px;
}
@media (max-width: 640px) {
  .collections-grid { grid-template-columns: 1fr; }
}
/* ── 骨架屏 ── */
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 28px;
}
.skeleton-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 14px;
  background: var(--surface-raised, #fff);
  box-shadow: var(--shadow-sm);
}
.sk {
  border-radius: 6px;
  background: linear-gradient(90deg, var(--surface-sunken, #f1f0ec) 25%, var(--surface-hover, #f5f5f0) 50%, var(--surface-sunken, #f1f0ec) 75%);
  background-size: 200% 100%;
  animation: sk-shimmer 1.4s ease-in-out infinite;
}
.sk-row { display: flex; align-items: center; justify-content: space-between; }
.sk-icon { width: 46px; height: 46px; border-radius: 10px; }
.sk-badge { width: 52px; height: 22px; border-radius: 999px; }
.sk-line { height: 13px; }
.sk-line.w-60 { width: 60%; }
.sk-line.w-90 { width: 90%; }
.sk-line.w-40 { width: 40%; }
.sk-actions { margin-top: 4px; }
.sk-btn { width: 72px; height: 33px; border-radius: 10px; }
.sk-btn-wide { flex: 1; }
@keyframes sk-shimmer {
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
  color: var(--text-tertiary, #9ca3af);
  background: var(--surface-raised, #fff);
  border: 1px dashed var(--border);
  border-radius: 14px;
  margin-bottom: 28px;
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
  font-size: 12px;
  color: var(--text-secondary);
  transition: background-color 180ms cubic-bezier(0.22, 1, 0.36, 1),
              color 180ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 180ms cubic-bezier(0.22, 1, 0.36, 1),
              transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.pagination button:not(:disabled):hover {
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.pagination button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.pagination button:not(:disabled):active {
  transform: scale(0.98);
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

/* ── 移动端适配 ── */
@media (max-width: 1024px) {
  .collections-page {
    padding: 72px 16px 96px;
  }
}
@media (max-width: 768px) {
  .collections-header {
    display: none;
  }
  .collections-page {
    padding: 68px 12px 96px;
  }
  .market-hero {
    padding: 24px 20px;
    border-radius: 14px;
  }
  .hero-title { font-size: 24px; }
  .hero-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .hero-toolbar .search-box {
    min-width: 0;
    width: 100%;
  }
  .hero-toolbar .sort-tabs {
    width: 100%;
    justify-content: space-between;
  }
  .hero-toolbar .sort-tabs button {
    flex: 1;
    text-align: center;
    padding: 7px 8px;
  }
  .collections-grid {
    grid-template-columns: 1fr;
  }
  .skeleton-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 480px) {
  .collections-page {
    padding: 60px 10px 96px;
  }
}
</style>
