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
        <span class="hero-orb hero-orb-a" aria-hidden="true"></span>
        <span class="hero-orb hero-orb-b" aria-hidden="true"></span>
        <span class="hero-orb hero-orb-c" aria-hidden="true"></span>
        <h1 class="hero-title">发现高质量主题书签集</h1>
        <p class="hero-sub">浏览社区精选的主题书签集，一键导入你的书库</p>
        <div class="hero-chips">
          <span class="hero-chip"><i class="ri-bookmark-2-line"></i> {{ pagination.total }} 个精选集</span>
          <span class="hero-chip"><i class="ri-flashlight-line"></i> 一键导入</span>
          <span class="hero-chip"><i class="ri-loop-left-line"></i> 持续更新</span>
        </div>
      </section>

    <!-- 搜索 & 排序 -->
    <div class="toolbar">
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

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      <i class="ri-loader-4-line spin"></i>
      <p>加载中...</p>
    </div>

    <!-- 空状态 -->
    <div v-else-if="collections.length === 0" class="empty-state">
      <i class="ri-inbox-line"></i>
      <p>暂无精选集</p>
      <span>成为第一个创建精选集的人吧！</span>
    </div>

    <!-- 卡片网格 -->
    <div v-else class="collections-grid">
      <CollectionCard v-for="(c, i) in collections" :key="c.id" :collection="c" :stagger-index="i" />
    </div>

    <!-- 分页 -->
    <div v-if="pagination.totalPages > 1" class="pagination">
      <button :disabled="pagination.page <= 1" @click="prevPage">上一页</button>
      <span class="page-info">{{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button :disabled="pagination.page >= pagination.totalPages" @click="nextPage">下一页</button>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, watch } from 'vue'
import CollectionCard from '~/components/collections/CollectionCard.vue'

definePageMeta({ layout: 'default' })

// SEO meta tags for collections market page
const _collectionsBase = (useRuntimeConfig().public.baseUrl as string) || 'https://favshub.com'
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
  backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--surface) 85%, transparent);
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
.market-hero {
  position: relative;
  padding: 34px 28px 30px;
  margin-bottom: 22px;
  border-radius: 18px;
  border: 1px solid var(--border);
  background:
    radial-gradient(ellipse 60% 120% at 85% -20%, color-mix(in srgb, var(--accent-purple, #8b5cf6) 14%, transparent), transparent),
    radial-gradient(ellipse 50% 110% at 8% -10%, color-mix(in srgb, var(--accent-blue, #3b82f6) 12%, transparent), transparent),
    var(--surface-raised, #fff);
  overflow: hidden;
}
.hero-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.5;
  pointer-events: none;
  animation: orb-float 9s ease-in-out infinite alternate;
}
.hero-orb-a {
  width: 220px; height: 220px;
  left: -60px; top: -110px;
  background: color-mix(in srgb, var(--accent-blue, #3b82f6) 34%, transparent);
}
.hero-orb-b {
  width: 260px; height: 260px;
  right: -80px; top: -130px;
  background: color-mix(in srgb, var(--accent-purple, #8b5cf6) 30%, transparent);
  animation-delay: -3s;
}
.hero-orb-c {
  width: 170px; height: 170px;
  left: 42%; bottom: -130px;
  background: color-mix(in srgb, var(--primary, #10b981) 26%, transparent);
  animation-delay: -6s;
}
@keyframes orb-float {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(26px, 14px) scale(1.12); }
}
@media (prefers-reduced-motion: reduce) {
  .hero-orb { animation: none; }
}
.hero-title {
  position: relative;
  margin: 0 0 8px;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.25;
  background: linear-gradient(100deg, var(--text-primary) 30%, var(--accent-blue, #3b82f6) 68%, var(--accent-purple, #8b5cf6));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: var(--text-primary);
}
.hero-sub {
  position: relative;
  margin: 0 0 16px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}
.hero-chips {
  position: relative;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.hero-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--surface-raised, #fff) 62%, transparent);
  border: 1px solid var(--border);
  backdrop-filter: blur(8px);
}
.hero-chip i { color: var(--primary); font-size: 14px; }
.collections-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 10px;
  background: var(--surface-raised, #fff);
  flex: 1;
  min-width: 200px;
  transition: border-color 0.18s, box-shadow 0.18s;
}
.search-box i { color: var(--text-tertiary); transition: color 0.18s; }
.search-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 16%, transparent);
}
.search-box:focus-within i { color: var(--primary); }
.search-box input {
  border: none;
  background: none;
  outline: none;
  font-size: 13px;
  width: 100%;
  color: var(--text-primary);
}
.sort-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--surface-sunken, #f3f4f6);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 10px;
}
.sort-tabs button {
  padding: 5px 14px;
  font-size: 12px;
  border: none;
  background: none;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-secondary, #6b7280);
  transition: all 0.18s;
}
.sort-tabs button:hover { color: var(--text-primary); }
.sort-tabs button.active {
  background: var(--surface-raised, #fff);
  color: var(--primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
}
.collections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
  margin-bottom: 24px;
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
  padding: 6px 16px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 999px;
  background: var(--surface-raised, #fff);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.18s;
}
.pagination button:not(:disabled):hover {
  border-color: var(--primary);
  color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 12%, transparent);
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
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .search-box {
    min-width: 0;
    width: 100%;
  }
  .sort-tabs {
    width: 100%;
    justify-content: space-between;
  }
  .sort-tabs button {
    flex: 1;
    text-align: center;
    padding: 6px 8px;
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
