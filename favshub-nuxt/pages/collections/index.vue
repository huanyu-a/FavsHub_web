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
          <NuxtLink to="/prompts" class="collections-header-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
            <span>提示词</span>
          </NuxtLink>
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

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      <i class="ri-loader-4-line spin"></i>
      <p>加载中...</p>
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
.collections-header {
  width: 100%;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.collections-header-inner {
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
.collections-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.collections-header-logo {
  display: flex;
  align-items: center;
  text-decoration: none;
  transition: opacity 0.15s;
}
.collections-header-logo:hover { opacity: 0.7; }
.collections-header-logo-img {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}
.collections-header-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.collections-header-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: nowrap;
}
.collections-header-link {
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
.collections-header-link svg {
  width: 15px;
  height: 15px;
  opacity: 0.7;
}
.collections-header-link:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.collections-header-link:hover svg { opacity: 1; }
.collections-header-link.active {
  color: var(--accent-blue, #3b82f6);
  background: var(--accent-blue-light, rgba(59, 130, 246, 0.08));
}
.collections-header-link.active svg { opacity: 1; }
/* ── 主色横幅：页面视觉锚点 ── */
.market-hero {
  background: var(--primary, #10b981);
  border-radius: 20px;
  padding: 34px 32px 30px;
  margin-bottom: 26px;
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
.hero-toolbar .sort-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: color-mix(in srgb, var(--text-inverse, #fff) 18%, transparent);
  border-radius: 12px;
}
.hero-toolbar .sort-tabs button {
  padding: 7px 16px;
  font-size: 12.5px;
  border: none;
  background: none;
  border-radius: 9px;
  cursor: pointer;
  color: color-mix(in srgb, var(--text-inverse, #fff) 88%, transparent);
  transition: all 0.18s;
}
.hero-toolbar .sort-tabs button:hover { background: color-mix(in srgb, var(--text-inverse, #fff) 14%, transparent); }
.hero-toolbar .sort-tabs button.active {
  background: var(--surface-raised, #fff);
  color: var(--primary, #10b981);
  font-weight: 600;
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
.loading-state, .empty-state {
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
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.05);
  cursor: pointer;
  font-size: 12.5px;
  color: var(--text-secondary);
  transition: all 0.18s;
}
.pagination button:not(:disabled):hover {
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px -2px rgba(16, 24, 40, 0.12);
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
}
@media (max-width: 480px) {
  .collections-page {
    padding: 60px 10px 96px;
  }
  .collections-header-title {
    font-size: 14px;
  }
}
</style>
