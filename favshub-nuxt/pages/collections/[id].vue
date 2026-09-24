<template>
  <div>
    <header class="collections-header">
      <div class="collections-header-inner">
        <div class="collections-header-left">
          <NuxtLink to="/" class="collections-header-logo" title="返回主页">
            <img src="/images/logo.svg" alt="Logo" class="collections-header-logo-img">
          </NuxtLink>
          <nav class="detail-breadcrumb">
            <NuxtLink to="/collections" class="breadcrumb-link">精选集市场</NuxtLink>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">
              <span v-if="collection && collection.icon" class="title-icon"><AppIcon :value="collection.icon" fallback="ri-book-2-line" /></span>
              {{ collection ? collection.name : '' }}
              <span v-if="collection && collection.is_official" class="official-tag">官方</span>
            </span>
          </nav>
        </div>
        <div class="header-actions">
          <button v-if="!selectMode && isLoggedIn" type="button" class="btn btn-subscribe-detail" :class="{ subscribed: isSubscribed }" :disabled="subscribing" @click="toggleSubscribe">
            <i :class="isSubscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'"></i>
            {{ isSubscribed ? '已订阅' : '订阅' }}
          </button>
          <button v-if="!selectMode && isLoggedIn" type="button" class="btn btn-primary" :disabled="importing" @click="importAll">
            <i :class="importing ? 'ri-loader-4-line spin' : 'ri-download-cloud-line'"></i> 导入全部
          </button>
          <button v-if="!selectMode && isLoggedIn" type="button" class="btn btn-secondary" @click="selectMode = true">
            <i class="ri-checkbox-line"></i> 选择导入
          </button>
          <span v-if="selectMode" class="selected-count">已选 {{ selectedIds.size }} 条</span>
          <button v-if="selectMode && isLoggedIn" type="button" class="btn btn-primary" :disabled="selectedIds.size === 0 || importing" @click="importSelected">
            <i :class="importing ? 'ri-loader-4-line spin' : 'ri-download-line'"></i> 导入已选
          </button>
          <button v-if="selectMode" type="button" class="btn btn-ghost" @click="cancelSelect">取消</button>
        </div>
      </div>
    </header>
    <div class="collection-detail-page">
    <header v-if="collection" class="detail-head">
      <span class="detail-icon-wrap">
        <AppIcon :value="collection.icon" fallback="ri-book-2-line" class="detail-hero-icon" />
      </span>
      <div class="detail-head-main">
        <h1 class="detail-head-name">
          {{ collection.name }}
          <span v-if="collection.is_official" class="detail-official-tag"><i class="ri-verified-badge-line"></i>官方</span>
        </h1>
        <p v-if="collection.description" class="detail-head-desc">{{ collection.description }}</p>
        <div class="detail-head-meta">
          <span><i class="ri-folder-2-line"></i>{{ collection.categories?.length || 0 }} 个分类</span>
          <span class="meta-sep"></span>
          <span><i class="ri-bookmark-line"></i>{{ collection.bookmark_count }} 条书签</span>
          <span class="meta-sep"></span>
          <span><i class="ri-user-3-line"></i>{{ collection.username || '匿名' }}</span>
          <template v-if="collection.updated_at || collection.created_at">
            <span class="meta-sep"></span>
            <span><i class="ri-refresh-line"></i>更新于 {{ formatHeroDate(collection.updated_at || collection.created_at) }}</span>
          </template>
        </div>
      </div>
    </header>
    <div v-if="loading" class="loading-state"><i class="ri-loader-4-line spin"></i><p>加载中...</p></div>
    <div v-else-if="collection && (!collection.categories || collection.categories.length === 0)" class="empty-state"><p>该精选集暂无书签</p></div>
    <div v-else class="categories-list">
      <template v-for="cat in (collection ? collection.categories : [])" :key="cat.name">
        <div class="category-section">
          <div class="category-header">
            <h2 class="category-name">{{ cat.name }} <span class="count">({{ cat.bookmark_count }})</span></h2>
            <button v-if="!selectMode && isLoggedIn" type="button" class="btn btn-sm btn-ghost" :disabled="importing" @click="importCategory(cat)">
              <i :class="importing ? 'ri-loader-4-line spin' : 'ri-add-line'"></i> 导入此分类
            </button>
          </div>
          <div v-if="cat.bookmarks.length" class="bookmarks-grid" :class="{ 'has-sub': cat.children && cat.children.length }">
            <div v-for="b in cat.bookmarks" :key="b.id" class="bookmark-card" :class="{ selected: selectedIds.has(b.id), selectable: selectMode && isLoggedIn }" @click="selectMode && isLoggedIn ? toggleSelect(b.id) : null">
              <label v-if="selectMode && isLoggedIn" class="card-checkbox" @click.stop>
                <input type="checkbox" :checked="selectedIds.has(b.id)" @change="toggleSelect(b.id)" />
              </label>
              <span v-if="!getFavicon(b) || failedIcons.has(b.id)" class="bookmark-icon bookmark-icon-fallback" :style="fallbackIconStyle(b)">{{ bookmarkInitial(b.title) }}</span>
              <img v-else :src="getFavicon(b)" class="bookmark-icon" loading="lazy" @error="onIconError($event, b)" />
              <div class="bookmark-info">
                <h3 class="bookmark-title"><a :href="b.url" target="_blank" rel="noopener" @click.stop>{{ b.title }}</a><span v-if="b.need_proxy" class="proxy-badge" title="需要代理访问"><i class="ri-router-line"></i></span></h3>
                <p v-if="b.description" class="bookmark-desc">{{ b.description }}</p>
                <a :href="b.url" target="_blank" rel="noopener" class="bookmark-url" @click.stop>{{ getUrlDomain(b.url) }}</a>
              </div>
              <button v-if="!selectMode && isLoggedIn" type="button" class="btn-import-one" title="导入此书签" :disabled="importing" @click.stop="importOne(b.id)">
                <i :class="importing ? 'ri-loader-4-line spin' : 'ri-add-line'"></i>
              </button>
            </div>
          </div>
          <!-- 子分类：嵌在父分类面板内 -->
          <div v-for="child in cat.children" :key="child.name" class="sub-category">
            <div class="category-header sub">
              <h3 class="category-name sub">{{ child.name }} <span class="count">({{ child.bookmark_count }})</span></h3>
              <button v-if="!selectMode && isLoggedIn" type="button" class="btn btn-sm btn-ghost" :disabled="importing" @click="importCategory(child)">
                <i :class="importing ? 'ri-loader-4-line spin' : 'ri-add-line'"></i> 导入
              </button>
            </div>
            <div v-if="child.bookmarks.length" class="bookmarks-grid">
              <div v-for="b in child.bookmarks" :key="b.id" class="bookmark-card" :class="{ selected: selectedIds.has(b.id), selectable: selectMode && isLoggedIn }" @click="selectMode && isLoggedIn ? toggleSelect(b.id) : null">
                <label v-if="selectMode && isLoggedIn" class="card-checkbox" @click.stop>
                  <input type="checkbox" :checked="selectedIds.has(b.id)" @change="toggleSelect(b.id)" />
                </label>
                <span v-if="!getFavicon(b) || failedIcons.has(b.id)" class="bookmark-icon bookmark-icon-fallback" :style="fallbackIconStyle(b)">{{ bookmarkInitial(b.title) }}</span>
                <img v-else :src="getFavicon(b)" class="bookmark-icon" loading="lazy" @error="onIconError($event, b)" />
                <div class="bookmark-info">
                  <h3 class="bookmark-title"><a :href="b.url" target="_blank" rel="noopener" @click.stop>{{ b.title }}</a><span v-if="b.need_proxy" class="proxy-badge" title="需要代理访问"><i class="ri-router-line"></i></span></h3>
                  <p v-if="b.description" class="bookmark-desc">{{ b.description }}</p>
                  <a :href="b.url" target="_blank" rel="noopener" class="bookmark-url" @click.stop>{{ getUrlDomain(b.url) }}</a>
                </div>
                <button v-if="!selectMode && isLoggedIn" type="button" class="btn-import-one" title="导入此书签" :disabled="importing" @click.stop="importOne(b.id)">
                  <i :class="importing ? 'ri-loader-4-line spin' : 'ri-add-line'"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
    <div v-if="selectMode && selectedIds.size > 0" class="bottom-bar">
      <span>已选择 {{ selectedIds.size }} 条</span>
      <button type="button" class="btn btn-primary" :disabled="importing" @click="importSelected">
        <i :class="importing ? 'ri-loader-4-line spin' : 'ri-download-line'"></i> 导入所选
      </button>
    </div>
    <div v-if="msg" class="toast" :class="msgType">{{ msg }}</div>
    <BackToTop />
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, h, onMounted, onUnmounted, watch } from 'vue'
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ layout: 'default' })

interface ICollectionBookmark {
  id: number; title: string; url: string; icon: string; description: string
  category_id: number | null; sort_order: number
  need_proxy?: number; folder_id?: number | null; folder_name?: string
}
interface ICollectionCategory {
  id: number; name: string; parent_id: number | null; _depth: number; bookmark_count: number; bookmarks: ICollectionBookmark[]; children: ICollectionCategory[]
}
interface ICollection {
  id: string; name: string; description: string; icon: string; is_public: number; is_official: number
  bookmark_count: number; created_at: number; updated_at?: number; user_id?: number; username?: string
  meta_title?: string; meta_description?: string; meta_keywords?: string
  categories?: ICollectionCategory[]
}
interface IImportResult {
  success: boolean; imported: number; skipped: number; folder_id: string | null; folder_name: string; collection_name: string
}

const route = useRoute()
const collectionId = computed(() => route.params.id as string)
const authStore = useAuthStore()
const isLoggedIn = computed(() => authStore.isLoggedIn)
const selectMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const msg = ref('')
const msgType = ref<'success' | 'error'>('success')
const importing = ref(false)
const subscribing = ref(false)
const isSubscribed = ref(false)

async function toggleSubscribe() {
  if (subscribing.value) return
  subscribing.value = true
  try {
    if (isSubscribed.value) {
      await $fetch(`/api/collections/${collectionId.value}/subscribe`, { method: 'DELETE' })
      isSubscribed.value = false
      showToast('已取消订阅', 'success')
    } else {
      await $fetch(`/api/collections/${collectionId.value}/subscribe`, { method: 'POST' })
      isSubscribed.value = true
      showToast('订阅成功', 'success')
    }
  } catch (e: any) {
    showToast(e?.data?.error || '操作失败', 'error')
  } finally {
    subscribing.value = false
  }
}

const { data: collectionData, pending } = await useFetch<{ collection: ICollection; categories: any[]; bookmarks: any[] }>(
  () => '/api/collections/' + collectionId.value,
  { server: true, lazy: false }
)
const loading = computed(() => pending.value)

// 检查并设置订阅状态（必须在 useFetch 之后）
watch(collectionData, (data) => {
  if (data?.is_subscribed !== undefined) {
    isSubscribed.value = !!data.is_subscribed
  }
}, { immediate: true })

// 将平级的 categories 和 bookmarks 转换为前端期望的格式
const collection = computed(() => {
  const rawCollection = collectionData.value?.collection
  if (!rawCollection) return null

  const categories = collectionData.value?.categories || []
  const bookmarks = collectionData.value?.bookmarks || []

  // 按分类分组书签（支持二级层级）
  // 分类计数：包含自身书签 + 子分类书签
  const childIds = new Map<number, number[]>()
  for (const cat of categories) {
    if (cat.parent_id) {
      if (!childIds.has(cat.parent_id)) childIds.set(cat.parent_id, [])
      childIds.get(cat.parent_id)!.push(cat.id)
    }
  }

  const groupedCategories: ICollectionCategory[] = categories
    .filter(cat => !cat.parent_id) // 只取顶级分类
    .map(cat => {
      const childrenIds = childIds.get(cat.id) || []
      const ownBookmarks = bookmarks.filter(bm => bm.category_id === cat.id)
      const childrenBookmarks = bookmarks.filter(bm => childrenIds.includes(bm.category_id))
      // 子分类仅保留有书签的
      const children: ICollectionCategory[] = categories
        .filter(c => c.parent_id === cat.id)
        .map(child => {
          const childBms = bookmarks.filter(bm => bm.category_id === child.id)
          return {
            id: child.id,
            name: child.name,
            parent_id: child.parent_id,
            _depth: 1,
            bookmark_count: childBms.length,
            bookmarks: childBms,
            children: []
          }
        })
        .filter(child => child.bookmark_count > 0)

      return {
        id: cat.id,
        name: cat.name,
        parent_id: null,
        _depth: 0,
        bookmark_count: ownBookmarks.length + childrenBookmarks.length,
        bookmarks: ownBookmarks,
        children
      }
    })
    // 顶级分类：自身与子分类书签均为 0 时不展示
    .filter(cat => cat.bookmark_count > 0)

  // 添加未分类的书签
  const categorizedIds = new Set(categories.map(c => c.id))
  const uncategorizedBookmarks = bookmarks.filter(bm => !bm.category_id || !categorizedIds.has(bm.category_id))
  if (uncategorizedBookmarks.length > 0) {
    groupedCategories.push({
      id: 0,
      name: '未分类',
      parent_id: null,
      _depth: 0,
      bookmark_count: uncategorizedBookmarks.length,
      bookmarks: uncategorizedBookmarks,
      children: []
    })
  }

  return {
    ...rawCollection,
    categories: groupedCategories
  }
})

// SEO meta tags for collection detail page
const config = useRuntimeConfig()
const baseUrl = config.public.baseUrl || 'https://hao.bx9y.com.cn'

watch(collection, (val) => {
  if (val?.name) {
    const title = val.meta_title || `${val.name}-网址导航精选集`
    const description = val.meta_description || val.description || `${val.name}网址导航精选集，收录 ${val.bookmark_count || 0} 个优质网站与工具，一键导入 FavsHub 打造你的专属导航页`
    const keywords = val.meta_keywords || `${val.name},网址导航,工具导航,精选集,FavsHub`
    const url = `${baseUrl}/collections/${val.id}`

    useHead({
      title,
      meta: [
        { name: 'description', content: description },
        { name: 'keywords', content: keywords },
        // Open Graph
        { property: 'og:site_name', content: 'FavsHub' },
        { property: 'og:title', content: val.meta_title || `${val.name}-网址导航精选集` },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'website' },
        { property: 'og:url', content: url },
        { property: 'og:locale', content: 'zh_CN' },
        // Twitter Card
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: val.meta_title || `${val.name}-网址导航精选集` },
        { name: 'twitter:description', content: description }
      ],
      link: [
        { rel: 'canonical', href: url },
      ],
      // JSON-LD structured data
      script: val.categories && val.categories.length > 0 ? [
        {
          type: 'application/ld+json',
          children: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: val.name,
            description: val.description || val.name,
            numberOfItems: val.bookmark_count || 0,
            itemListElement: val.categories[0]?.bookmarks?.slice(0, 10).map((bm: ICollectionBookmark, idx: number) => ({
              '@type': 'ListItem',
              position: idx + 1,
              name: bm.title,
              url: bm.url
            })) || []
          })
        }
      ] : []
    })
  }
}, { immediate: true })

function toggleSelect(id: number) { const s = selectedIds.value; if (s.has(id)) s.delete(id); else s.add(id) }
function cancelSelect() { selectMode.value = false; selectedIds.value = new Set() }

async function importAll() {
  if (importing.value) return; importing.value = true
  try { const r = await $fetch<IImportResult>('/api/collections/' + collectionId.value + '/import', { method: 'POST', body: { mode: 'all' } }); showToast('成功导入 ' + r.imported + ' 条' + (r.skipped ? '（跳過 ' + r.skipped + ' 条重複）' : ''), 'success') }
  catch (e: any) { showToast(e?.data?.error || '导入失败', 'error') }
  finally { importing.value = false }
}
async function importCategory(cat: ICollectionCategory) {
  if (importing.value) return; importing.value = true
  try { const r = await $fetch<IImportResult>('/api/collections/' + collectionId.value + '/import', { method: 'POST', body: { mode: 'category', category_id: cat.id } }); showToast('导入「' + cat.name + '」' + r.imported + ' 条', 'success') }
  catch (e: any) { showToast(e?.data?.error || '导入失败', 'error') }
  finally { importing.value = false }
}
async function importSelected() {
  if (selectedIds.value.size === 0 || importing.value) return; importing.value = true
  try { const r = await $fetch<IImportResult>('/api/collections/' + collectionId.value + '/import', { method: 'POST', body: { mode: 'selected', bookmark_ids: Array.from(selectedIds.value) } }); showToast('成功导入 ' + r.imported + ' 条', 'success'); cancelSelect() }
  catch (e: any) { showToast(e?.data?.error || '导入失败', 'error') }
  finally { importing.value = false }
}
async function importOne(bid: number) {
  if (importing.value) return; importing.value = true
  try { const r = await $fetch<IImportResult>('/api/collections/' + collectionId.value + '/import', { method: 'POST', body: { mode: 'selected', bookmark_ids: [bid] } }); showToast(r.imported ? '已导入' : '已在书库中', 'success') }
  catch (e: any) { showToast(e?.data?.error || '导入失败', 'error') }
  finally { importing.value = false }
}
function getUrlDomain(u: string) { try { return new URL(u).hostname } catch { return u } }
function formatHeroDate(ts: number) {
  try {
    return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch { return '' }
}
function getFavicon(b: ICollectionBookmark) { return resolveBookmarkIcon(b.icon, b.url) || '' }

// ── 书签图标：加载失败先走代理自愈一次，仍失败 → 首字母色块（按 id 确定性取色，SSR/客户端一致） ──
const failedIcons = ref(new Set<number>())
function onIconError(e: Event, b: ICollectionBookmark) {
  const img = e.target as HTMLImageElement
  if (!img.src.includes('/api/favicon')) {
    const proxy = fallbackProxyIcon(b.icon, b.url)
    if (proxy) {
      img.src = proxy
      return
    }
  }
  failedIcons.value.add(b.id)
}
function bookmarkInitial(title: string) {
  const t = (title || '').trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}
function fallbackIconStyle(b: ICollectionBookmark) {
  const hue = (b.id || 0) * 47 % 360
  return {
    background: `linear-gradient(135deg, hsl(${hue}, 62%, 62%), hsl(${(hue + 42) % 360}, 58%, 46%))`,
  }
}
let msgTimer: ReturnType<typeof setTimeout>
function showToast(t: string, type: 'success' | 'error') { msg.value = t; msgType.value = type; clearTimeout(msgTimer); msgTimer = setTimeout(() => { msg.value = '' }, 2500) }

// Mobile header: inject action buttons into MobileHeader
const { mobileActionsSlot } = useMobile()
onMounted(() => {
  mobileActionsSlot.value = () => [
    h('button', {
      class: ['btn-favorite', { subscribed: isSubscribed.value }],
      title: isSubscribed.value ? '已订阅' : '订阅',
      disabled: subscribing.value,
      onClick: () => toggleSubscribe(),
    }, [
      h('i', { class: isSubscribed.value ? 'ri-bookmark-fill' : 'ri-bookmark-line' }),
      h('span', null, isSubscribed.value ? '已订阅' : '订阅'),
    ]),
    h('button', {
      class: 'btn btn-primary',
      title: '导入全部',
      disabled: importing.value,
      onClick: () => importAll(),
    }, [
      h('i', { class: importing.value ? 'ri-loader-4-line spin' : 'ri-download-cloud-line' }),
      h('span', null, '导入'),
    ]),
    h('button', {
      class: 'btn btn-secondary',
      title: '选择导入',
      onClick: () => { selectMode.value = true },
    }, [
      h('i', { class: 'ri-checkbox-line' }),
      h('span', null, '选择'),
    ]),
  ]
})
onUnmounted(() => { clearTimeout(msgTimer); mobileActionsSlot.value = null })
</script>
<style scoped>
/* Sticky header (same as collections index) */
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
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.15s;
  white-space: nowrap;
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

.collection-detail-page { max-width: 1100px; margin: 0 auto; padding: 24px; }

/* ── 详情页页头：渐变横幅 + 高光 + 点阵纹理 ── */
.detail-head {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 28px 30px;
  margin-bottom: 24px;
  border-radius: 20px;
  background:
    radial-gradient(130% 150% at 88% -30%, color-mix(in srgb, #fff 26%, transparent) 0%, transparent 52%),
    radial-gradient(120% 130% at -10% 130%, rgba(0, 0, 0, 0.14) 0%, transparent 55%),
    linear-gradient(135deg, var(--primary, #10b981) 0%, color-mix(in srgb, var(--primary, #10b981) 72%, var(--primary-dark, #059669)) 100%);
  color: var(--text-inverse, #fff);
}
.detail-head::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background-image: radial-gradient(color-mix(in srgb, #fff 55%, transparent) 1px, transparent 1.5px);
  background-size: 22px 22px;
  opacity: 0.14;
  mask-image: radial-gradient(90% 130% at 100% 0%, #000 0%, transparent 72%);
  -webkit-mask-image: radial-gradient(90% 130% at 100% 0%, #000 0%, transparent 72%);
  pointer-events: none;
}
.detail-head > * { position: relative; z-index: 1; }
.detail-icon-wrap {
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: var(--text-inverse, #fff);
  background: color-mix(in srgb, var(--text-inverse, #fff) 20%, transparent);
}
.detail-hero-icon { font-style: normal; }
.detail-head-main { min-width: 0; flex: 1; }
.detail-head-name {
  margin: 0 0 6px;
  font-size: 25px;
  font-weight: 800;
  letter-spacing: -0.022em;
  color: var(--text-inverse, #fff);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.detail-official-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--primary, #10b981);
  background: var(--surface-raised, #fff);
}
.detail-official-tag i { font-size: 12px; }
.detail-head-desc {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 1.6;
  color: color-mix(in srgb, var(--text-inverse, #fff) 82%, transparent);
}
.detail-head-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12.5px;
}
.detail-head-meta > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.14);
  backdrop-filter: blur(4px);
  color: color-mix(in srgb, var(--text-inverse, #fff) 88%, transparent);
}
.detail-head-meta i { font-size: 13px; opacity: 0.85; }
.detail-head-meta > span.meta-sep { display: none; }

.detail-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.breadcrumb-link { color: var(--text-tertiary, #9ca3af); text-decoration: none; transition: color 0.15s; white-space: nowrap; }
.breadcrumb-link:hover { color: var(--primary, #10b981); }
.breadcrumb-sep { color: var(--text-quaternary, #d1d5db); font-size: 13px; user-select: none; }
.breadcrumb-current { display: inline-flex; align-items: center; gap: 5px; color: var(--text-primary); font-weight: 600; white-space: nowrap; }
.title-icon { font-size: 15px; display: inline-flex; align-items: center; color: var(--primary); }
.official-tag { font-size: 11px; font-weight: 600; color: #f59e0b; background: color-mix(in srgb, #f59e0b 12%, transparent); padding: 2px 8px; border-radius: 10px; }
.header-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.selected-count { font-size: 13px; color: var(--text-secondary, #6b7280); }
.btn { display: inline-flex; align-items: center; gap: 3px; padding: 5px 12px; border-radius: 7px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; }
.btn i { font-size: 13px; }
.btn-subscribe-detail {
  display: inline-flex; align-items: center; gap: 3px; padding: 5px 12px; border-radius: 7px;
  font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s;
  background: var(--surface-sunken, #f3f4f6); color: var(--text-secondary, #6b7280);
  border: 1px solid var(--border, #e5e7eb);
}
.btn-subscribe-detail:hover { color: var(--primary, #10b981); border-color: var(--primary, #10b981); }
.btn-subscribe-detail.subscribed { color: var(--primary, #10b981); border-color: var(--primary, #10b981); background: color-mix(in srgb, var(--primary, #10b981) 10%, transparent); }
.btn-subscribe-detail:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--primary, #10b981); color: #fff; }
.btn-primary:hover { background: color-mix(in srgb, var(--primary, #10b981) 85%, #000); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--surface-sunken, #f3f4f6); color: var(--text-primary); border-color: var(--border, #e5e7eb); }
.btn-secondary:hover { background: var(--surface-active, #e5e7eb); }
.btn-ghost { background: none; color: var(--text-secondary, #6b7280); border-color: var(--border, #e5e7eb); }
.btn-ghost:hover { background: var(--surface-hover, #f9fafb); }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; color: var(--text-tertiary, #9ca3af); }
.categories-list { display: flex; flex-direction: column; gap: 20px; }
.category-section {
  padding: 20px;
  border-radius: 16px;
  background: var(--surface-raised, #fff);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.05);
}
.category-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.category-name {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.015em;
  display: flex;
  align-items: center;
  gap: 10px;
}
.category-name::before {
  content: '';
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: var(--primary);
  flex-shrink: 0;
}
.category-name.sub { font-size: 14px; font-weight: 600; color: var(--text-secondary); }
.category-name.sub::before { height: 12px; opacity: 0.55; }
.sub-category { margin-top: 20px; }
.sub-category .category-header { margin-bottom: 12px; }
.bookmarks-grid.has-sub { margin-bottom: 20px; }
.count { font-size: 13px; font-weight: 400; color: var(--text-tertiary, #9ca3af); }
.bookmarks-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 12px; }
.bookmark-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 13px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface-sunken, #f3f4f6) 62%, transparent);
  transition: background 0.16s, box-shadow 0.16s, transform 0.16s;
}
.bookmark-card.selectable { cursor: pointer; }
.bookmark-card:hover {
  background: var(--surface-raised, #fff);
  box-shadow: 0 6px 16px -4px rgba(16, 24, 40, 0.13), 0 2px 4px -2px rgba(16, 24, 40, 0.05), inset 0 0 0 1px color-mix(in srgb, var(--primary, #10b981) 16%, transparent);
  transform: translateY(-1px);
}
.bookmark-card.selected { background: color-mix(in srgb, var(--primary, #10b981) 10%, transparent); }
.card-checkbox { flex-shrink: 0; margin-top: 2px; cursor: pointer; }
.bookmark-icon { width: 26px; height: 26px; border-radius: 6px; flex-shrink: 0; margin-top: 1px; object-fit: contain; background: var(--surface-sunken, #f3f4f6); }
.bookmark-icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12.5px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  user-select: none;
}
.bookmark-info { flex: 1; min-width: 0; }
.bookmark-title { margin: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bookmark-title a { color: inherit; text-decoration: none; transition: color 0.15s; }
.bookmark-title a:hover { color: var(--primary, #10b981); }
.bookmark-desc { margin: 3px 0; font-size: 12px; color: var(--text-tertiary, #9ca3af); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bookmark-url { font-size: 11.5px; color: var(--text-tertiary, #9ca3af); text-decoration: none; transition: color 0.15s; }
.bookmark-url:hover { color: var(--primary, #10b981); }
.btn-import-one { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; background: none; cursor: pointer; color: var(--text-secondary, #6b7280); flex-shrink: 0; }
.btn-import-one:hover { background: var(--primary, #10b981); color: #fff; border-color: var(--primary, #10b981); }
.bottom-bar { position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 12px; padding: 12px 24px; background: var(--surface-raised, #fff); border-top: 1px solid var(--border, #e5e7eb); box-shadow: 0 -2px 8px rgba(0,0,0,0.06); z-index: 50; }
.toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 10px 20px; border-radius: 8px; font-size: 14px; z-index: 100; }
.toast.success { background: #10b981; color: #fff; }
.toast.error { background: #ef4444; color: #fff; }

/* ── 移动端适配 ── */
@media (max-width: 1024px) {
  .collection-detail-page {
    padding: 72px 16px 96px;
  }
  .bottom-bar {
    bottom: 72px;
    padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
    z-index: 9990;
  }
  .toast {
    top: 68px;
    z-index: 10010;
  }
}
@media (max-width: 1024px) {
  .collections-header { display: none; }
}
@media (max-width: 768px) {
  .collection-detail-page {
    padding: 68px 12px 96px;
  }
  .header-actions {
    flex-wrap: nowrap;
    width: 100%;
    gap: 6px;
  }
  .header-actions .btn,
  .header-actions .btn-subscribe-detail {
    flex: 1;
    justify-content: center;
    min-width: 0;
    padding: 7px 0;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
  }
  .sub-category {
    margin-left: 8px;
    padding-left: 10px;
  }
  .bookmarks-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .category-name {
    font-size: 16px;
  }
  .category-header {
    flex-wrap: wrap;
    gap: 8px;
  }
  .detail-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    padding: 22px 20px;
    border-radius: 16px;
  }
  .detail-head-name { font-size: 21px; }
}
@media (max-width: 480px) {
  .collection-detail-page {
    padding: 60px 10px 96px;
  }
  .bookmarks-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .bookmark-card {
    padding: 8px;
    gap: 6px;
  }
  .bookmark-icon {
    width: 20px;
    height: 20px;
  }
  .bookmark-title {
    font-size: 13px;
  }
  .bookmark-desc {
    display: none;
  }
  .header-actions .btn,
  .header-actions .btn-subscribe-detail {
    font-size: 11px;
    padding: 7px 4px;
  }
}
</style>
