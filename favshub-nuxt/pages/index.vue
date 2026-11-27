<template>
  <div class="home-shell">
    <!-- 壁纸背景 -->

    <!-- 侧边栏（自带 #sidebar-container 包裹） -->
    <Sidebar
      :is-open="uiStore.sidebarOpen"
      :folders="bookmarksStore.folders"
      :current-folder-id="bookmarksStore.currentFolderId"
      active-page="home"
      :is-admin="authStore.isAdmin"
      :is-guest="authStore.isGuest"
      :collection-categories="bookmarksStore.collectionCategories"
      :active-collection-id="bookmarksStore.currentCollectionId"
      :active-category-id="bookmarksStore.activeCategoryId"
      @toggle="uiStore.toggleSidebar()"
      @select-folder="selectFolder"
      @create-folder="showCreateFolder"
      @select-collection="selectCollection"
      @select-collection-category="selectCollectionCategory"
    />

    <!-- 主内容区（布局样式由全局 .home-shell > main 提供，背景继承 var(--surface)） -->
    <main ref="homeMain">
      <!-- 欢迎消息 - ClientOnly: greeting 依赖 authStore.user，SSR/客户端不一致 -->
      <ClientOnly>
        <WelcomeMessage v-if="settingsStore.get('showWelcomeMessage', true)" />
      </ClientOnly>

      <!-- 搜索栏 -->
      <div class="flex justify-center items-center" v-if="settingsStore.get('showSearchBox', true)">
        <SearchBar
          :engines="searchEngineStore.defaultEngines.length > 0 ? searchEngineStore.defaultEngines : searchEngineStore.engines"
          :all-engines="searchEngineStore.engines"
          :current-engine="searchEngineStore.currentEngine"
          :bookmarks="bookmarksStore.bookmarks"
          @search="handleSearch"
          @select-engine="searchEngineStore.setCurrentEngine"
        />
      </div>

      <!-- 精选集 tabs：已登录显示已订阅；未登录不显示 -->
      <!-- ClientOnly: authStore.isLoggedIn SSR/客户端状态不一致，防止水合不匹配 -->
      <ClientOnly>
        <div v-if="authStore.isLoggedIn" class="collection-tabs-container">
        <div class="collection-tabs">
          <button
            class="collection-tab"
            :class="{ active: !currentCollectionId }"
            @click="router.push('/')"
          >
            <i class="ri-home-line"></i>
            全部书签
          </button>
          <button
            v-for="col in bookmarksStore.myCollections"
            :key="col.id"
            class="collection-tab"
            :class="{ active: currentCollectionId === col.id }"
            @click="router.push({ query: { collection: col.id } })"
          >
            <span class="tab-icon"><AppIcon :value="col.icon" fallback="ri-book-2-line" /></span>
            <span class="tab-name">{{ col.name }}</span>
            <span v-if="col.new_count && col.new_count > 0" class="tab-badge">{{ col.new_count }}</span>
          </button>
        </div>
      </div>
      </ClientOnly>

      <!-- 书签网格 -->
      <BookmarkGrid
        :bookmarks="displayBookmarks"
        :folders="displayFolders"
        :current-folder-id="bookmarksStore.currentFolderId"
        :is-loading="bookmarksStore.isLoading"
        :is-guest="authStore.isGuest"
        :current-user-id="authStore.user?.id"
        :bookmark-width="settingsStore.get('bookmarkWidth', 210)"
        :bookmark-card-height="settingsStore.get('bookmarkCardHeight', 50)"
        :bookmark-container-width="settingsStore.get('bookmarkContainerWidth', 90)"
        @edit="openEditDialog"
        @delete="confirmDelete"
        @reorder="handleReorder"
        @add="openAddDialog"
      />

      <!-- 编辑/添加弹窗 -->
      <BookmarkEditDialog
        v-if="editDialogVisible"
        :bookmark="editingBookmark"
        :folders="bookmarksStore.folders"
        :is-new="isNewBookmark"
        :is-admin="authStore.isAdmin"
        @save="saveBookmark"
        @close="editDialogVisible = false"
      />

      <!-- 确认删除弹窗 -->
      <div v-if="deleteConfirmVisible" id="confirm-dialog" class="modal" style="display:flex;" @click.self="deleteConfirmVisible = false">
        <div class="modal-content">
          <h2 id="confirm-dialog-title">确认删除</h2>
          <p id="confirm-dialog-message">确定要删除「{{ deletingBookmark?.title }}」吗？</p>
          <div class="buttons">
            <button id="cancel-delete-button" class="cancel-button" @click="deleteConfirmVisible = false">取消</button>
            <button id="confirm-delete-button" class="delete-button" @click="executeDelete">删除</button>
          </div>
        </div>
      </div>

      <!-- 创建文件夹弹窗 -->
      <div v-if="createFolderVisible" class="modal" style="display:flex;" @click.self="createFolderVisible = false">
        <div class="modal-content">
          <h2>创建文件夹</h2>
          <div style="margin: 12px 0;">
            <input
              ref="createFolderInput"
              v-model="newFolderName"
              class="search-input"
              style="width: 100%; box-sizing: border-box;"
              placeholder="请输入文件夹名称"
              @keyup.enter="executeCreateFolder"
            />
          </div>
          <div class="buttons">
            <button class="cancel-button" @click="createFolderVisible = false">取消</button>
            <button class="delete-button" @click="executeCreateFolder" :disabled="!newFolderName.trim()">创建</button>
          </div>
        </div>
      </div>

      <!-- 统一页脚：含年度进度条与友情链接 -->
      <div v-if="settingsStore.get('showFooter', true)" class="page-footer-container">
        <div class="progress-wrap"><YearProgress /></div>
        <SiteFooter />
      </div>
    </main>

    <!-- 侧边栏切换按钮 -->
    <button id="toggle-sidebar" @click="uiStore.toggleSidebar()" title="收起/展开侧边栏">
      {{ uiStore.sidebarOpen ? '<' : '>' }}
    </button>

    <!-- 回到顶部按钮 -->
    <BackToTop />

  </div>
</template>

<script lang="ts">
export interface HomeScrollPosition {
  main: number
  window: number
}

/** 无记录与损坏记录都显式归零，避免新视图继承上一视图的滚动偏移。 */
export function parseHomeScrollPosition(raw: string | null): HomeScrollPosition {
  const zero = { main: 0, window: 0 }
  if (!raw) return zero
  try {
    const saved = JSON.parse(raw) as { main?: unknown; window?: unknown } | null
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return zero
    if (saved.main != null && (typeof saved.main !== 'number' || !Number.isFinite(saved.main))) return zero
    if (saved.window != null && (typeof saved.window !== 'number' || !Number.isFinite(saved.window))) return zero
    return {
      main: Math.max(0, typeof saved.main === 'number' ? saved.main : 0),
      window: Math.max(0, typeof saved.window === 'number' ? saved.window : 0),
    }
  } catch {
    return zero
  }
}

/** 每个关键 await 前后都检查路由活跃状态，离路后不再执行后续挂载步骤。 */
export async function runHomeMountSequence(
  isActive: () => boolean,
  steps: Array<() => void | Promise<void>>,
): Promise<boolean> {
  for (const step of steps) {
    if (!isActive()) return false
    await step()
  }
  return isActive()
}

export interface HomeScrollRestoreOptions {
  isActive: () => boolean
  nextTick: () => Promise<void>
  requestFrame: (callback: () => void) => void
  hasHash: () => boolean
  restoreHash: () => void
  readPosition: () => HomeScrollPosition
  applyPosition: (position: HomeScrollPosition) => void
  setRestoring: (value: boolean) => void
}

/** double-rAF 的两个回调及最终应用前均防离路/版本失效。 */
export async function restoreHomeScrollWhenActive(
  options: HomeScrollRestoreOptions,
  preserveInitialHash = false,
): Promise<boolean> {
  if (!options.isActive()) return false
  options.setRestoring(true)
  await options.nextTick()
  if (!options.isActive()) return false

  await new Promise<void>(resolve => {
    options.requestFrame(() => {
      if (!options.isActive()) {
        resolve()
        return
      }
      options.requestFrame(() => resolve())
    })
  })
  if (!options.isActive()) return false

  if (preserveInitialHash && options.hasHash()) options.restoreHash()
  else options.applyPosition(options.readPosition())

  options.requestFrame(() => {
    if (options.isActive()) options.setRestoring(false)
  })
  return true
}

export interface HomeCollectionLoaderStore {
  isLoading: boolean
  fetchCollectionData: (id: string) => Promise<void>
  setCurrentCollection: (id: string | null) => void
  fetchBookmarks: () => Promise<void>
  invalidateCollectionData: () => void
}

/** 页面级提交令牌与 store generation 双层隔离，防止乱序响应改变当前视图。 */
export function createHomeCollectionLoader(store: HomeCollectionLoaderStore) {
  let lastLoadedCollectionId: string | null | undefined
  let collectionLoadToken = 0

  return {
    async load(collectionId: string) {
      // watch 与 onMounted 在 hydration 阶段可能同时命中同一精选集。
      if (lastLoadedCollectionId === collectionId) return
      lastLoadedCollectionId = collectionId
      const token = ++collectionLoadToken
      store.isLoading = true
      try {
        await store.fetchCollectionData(collectionId)
        if (token !== collectionLoadToken) return
        store.setCurrentCollection(collectionId)
      } catch (err) {
        if (token === collectionLoadToken) console.error('加载精选集书签失败', err)
      } finally {
        if (token === collectionLoadToken) store.isLoading = false
      }
    },

    async loadMine() {
      // 必须先使 A 的页面提交令牌失效，再切换视图并拉取个人书签。
      ++collectionLoadToken
      lastLoadedCollectionId = undefined
      store.setCurrentCollection(null)
      await store.fetchBookmarks()
    },

    invalidate() {
      ++collectionLoadToken
      lastLoadedCollectionId = undefined
      store.invalidateCollectionData()
    },
  }
}
</script>

<script setup lang="ts">
import Sidebar from '~/components/sidebar/Sidebar.vue'
import SearchBar from '~/components/search/SearchBar.vue'
import BookmarkGrid from '~/components/bookmark/BookmarkGrid.vue'
import BookmarkEditDialog from '~/components/bookmark/BookmarkEditDialog.vue'
import WelcomeMessage from '~/components/WelcomeMessage.vue'
import YearProgress from '~/components/YearProgress.vue'
import BackToTop from '~/components/BackToTop.vue'
import SiteFooter from '~/components/common/SiteFooter.vue'

definePageMeta({ layout: 'default', scrollToTop: false })

const authStore = useAuthStore()
const bookmarksStore = useBookmarksStore()
const settingsStore = useSettingsStore()
const searchEngineStore = useSearchEnginesStore()
const uiStore = useUIStore()
const route = useRoute()
const router = useRouter()

const editDialogVisible = ref(false)
const isNewBookmark = ref(false)
const editingBookmark = ref<any>(null)

const deleteConfirmVisible = ref(false)
const deletingBookmark = ref<any>(null)

const createFolderVisible = ref(false)
const newFolderName = ref('')
const createFolderInput = ref<HTMLInputElement | null>(null)

const searchQuery = ref('')

// 精选集相关
const currentCollectionId = computed(() => route.query.collection as string | undefined)

// 桌面/平板滚动在 main，手机滚动在 window；两种位置按书签视图分别保存。
// sessionStorage 同时覆盖 SPA 返回与当前标签页刷新，不跨标签页泄漏浏览状态。
const homeMain = ref<HTMLElement | null>(null)
const SCROLL_STORAGE_PREFIX = 'favshub_home_scroll:'
let scrollSaveFrame: number | null = null
let scrollRestoreVersion = 0
let restoringScroll = false
let leavingHome = false
let previousScrollRestoration: ScrollRestoration | null = null
let activeScrollViewId: string | null | undefined = currentCollectionId.value
let homeMounted = false

function scrollStorageKey(collectionId: string | null | undefined = activeScrollViewId) {
  return SCROLL_STORAGE_PREFIX + encodeURIComponent(collectionId || 'mine')
}

function saveScrollPosition(collectionId: string | null | undefined = activeScrollViewId) {
  if (!import.meta.client) return
  try {
    sessionStorage.setItem(scrollStorageKey(collectionId), JSON.stringify({
      main: Math.max(0, homeMain.value?.scrollTop || 0),
      window: Math.max(0, window.scrollY || 0),
    }))
  } catch { /* 存储不可用时保留浏览器原生行为 */ }
}

function scheduleScrollSave() {
  if (restoringScroll || scrollSaveFrame !== null) return
  scrollSaveFrame = requestAnimationFrame(() => {
    scrollSaveFrame = null
    saveScrollPosition()
  })
}

async function restoreScrollPosition(preserveInitialHash = false) {
  const version = ++scrollRestoreVersion
  await restoreHomeScrollWhenActive({
    isActive: () => homeMounted && !leavingHome && version === scrollRestoreVersion,
    nextTick: () => nextTick(),
    requestFrame: callback => { requestAnimationFrame(() => callback()) },
    hasHash: () => Boolean(window.location.hash),
    restoreHash: () => {
      let id = window.location.hash.slice(1)
      try { id = decodeURIComponent(id) } catch { /* 非法编码的 hash 按原样查找 */ }
      document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'auto' })
    },
    readPosition: () => {
      try {
        return parseHomeScrollPosition(sessionStorage.getItem(scrollStorageKey()))
      } catch {
        return { main: 0, window: 0 }
      }
    },
    applyPosition: saved => {
      if (homeMain.value) homeMain.value.scrollTop = saved.main
      window.scrollTo({ top: saved.window, behavior: 'auto' })
    },
    setRestoring: value => { restoringScroll = value },
  }, preserveInitialHash)
}

function handlePageHide() {
  saveScrollPosition()
}

onBeforeRouteLeave((_to, _from, next) => {
  leavingHome = true
  homeCollectionLoader.invalidate()
  ++scrollRestoreVersion
  saveScrollPosition()
  next()
})

const displayBookmarks = computed(() => {
  // 精选集浏览模式：展示全部书签，按分类分组（不做筛选，全部可见）
  if (bookmarksStore.viewMode === 'collection') {
    return bookmarksStore.collectionBookmarks.map(b => ({
      ...b,
      folder_id: b.category_id ?? null
    }))
  }
  // 个人书签模式
  let result = bookmarksStore.bookmarks
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(b =>
      b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
    )
  }
  return result
})

// 书签网格的分组依据：精选集模式用分类，个人模式用文件夹
const displayFolders = computed(() => {
  if (bookmarksStore.viewMode === 'collection') {
    // 构建带层级的分类列表：先顶级，再子级
    const cats = bookmarksStore.collectionCategories
    const result: { id: number; name: string; parent_id: number | null }[] = []
    // 顶级分类
    for (const c of cats) {
      if (!c.parent_id) {
        result.push({ id: c.id, name: c.name, parent_id: null })
        // 子分类紧跟其后
        for (const child of cats) {
          if (child.parent_id === c.id) {
            result.push({ id: child.id, name: '  ' + child.name, parent_id: c.id })
          }
        }
      }
    }
    return result
  }
  return bookmarksStore.folders
})

// ── SSR 数据预取 + 客户端 hydration ──────────────────────
// 使用 useFetch 而非 store 的 $fetch，确保 SSR 正确转发请求上下文

// C2: SSR/hydration 只加载前 30 条，降低 HTML 体积与 DOM 节点数；客户端挂载后补齐剩余
const SSR_LOAD_LIMIT = 30

const { data: bookmarksData } = await useFetch(`/api/bookmarks?limit=${SSR_LOAD_LIMIT}`, {
  headers: authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {},
  credentials: 'include',
  dedupe: 'defer',
})
const { data: enginesData } = await useFetch('/api/search-engines', { dedupe: 'defer' })
const { data: settingsData } = await useFetch('/api/settings', {
  headers: authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {},
  credentials: 'include',
  dedupe: 'defer',
})

// 同步到 store
watchEffect(() => {
  const bm = bookmarksData.value as any
  if (bm?.bookmarks) {
    bookmarksStore.bookmarks = bm.bookmarks
    bookmarksStore.folders = bm.folders || []
  }
  const eng = enginesData.value as any
  if (eng?.engines) {
    searchEngineStore.engines = eng.engines
  }
  const set = settingsData.value as any
  if (set?.data) {
    settingsStore.settings = { ...settingsStore.defaults, ...set.data }
  }
})

// C2: 首屏只 SSR 30 条，挂载后补齐剩余书签
let bookmarksFullyLoaded = false
async function loadRemainingBookmarks() {
  if (bookmarksFullyLoaded) return
  bookmarksFullyLoaded = true
  const currentCount = bookmarksStore.bookmarks.length
  const res = bookmarksData.value as any
  const total = res?.pagination?.total
  if (total != null && currentCount >= total) return
  await bookmarksStore.fetchBookmarks()
}

// 精选集请求由页面提交令牌与 store generation 双重隔离。
const homeCollectionLoader = createHomeCollectionLoader(bookmarksStore)

// 监听精选集切换，加载对应书签；各视图保留自己的滚动位置
watch(currentCollectionId, async (newId, oldId) => {
  if (leavingHome) return
  saveScrollPosition(oldId ?? null)
  activeScrollViewId = newId ?? null
  restoringScroll = true
  ++scrollRestoreVersion
  if (newId) {
    await homeCollectionLoader.load(newId)
  } else if (oldId) {
    // loadMine 先递增页面令牌并使 store 旧请求失效，再拉取个人书签。
    await homeCollectionLoader.loadMine()
  }
  await restoreScrollPosition()
})

// SSR hydration 后检查 URL 是否带有 collection 参数，加载对应书签
onMounted(async () => {
  homeMounted = true
  homeMain.value?.addEventListener('scroll', scheduleScrollSave, { passive: true })
  window.addEventListener('scroll', scheduleScrollSave, { passive: true })
  window.addEventListener('pagehide', handlePageHide)
  if ('scrollRestoration' in history) {
    previousScrollRestoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
  }
  restoringScroll = true

  await runHomeMountSequence(() => homeMounted && !leavingHome, [
    // 等渐进渲染所需的数据到位后恢复，避免先按 30 条的短页面定位。
    () => loadRemainingBookmarks(),
    async () => {
      if (authStore.isLoggedIn) await bookmarksStore.fetchMyCollections()
    },
    async () => {
      // URL 带有 collection 参数时加载对应精选集；await 后由 runner 再查活跃状态。
      const collectionId = currentCollectionId.value
      if (collectionId) await homeCollectionLoader.load(collectionId)
    },
    () => restoreScrollPosition(true),
  ])
})

function selectCollection(id: string) {
  router.push({ query: { collection: id } })
}

// C6: 保存滚动高亮的 timeout ID，卸载时统一 clearTimeout
let highlightTimeouts: ReturnType<typeof setTimeout>[] = []
function scheduleHighlightClear(fn: () => void, delay: number) {
  const id = setTimeout(() => {
    highlightTimeouts = highlightTimeouts.filter(t => t !== id)
    fn()
  }, delay)
  highlightTimeouts.push(id)
}

onBeforeUnmount(() => {
  leavingHome = true
  homeMounted = false
  homeCollectionLoader.invalidate()
  ++scrollRestoreVersion
  saveScrollPosition()
  if (scrollSaveFrame !== null) cancelAnimationFrame(scrollSaveFrame)
  scrollSaveFrame = null
  homeMain.value?.removeEventListener('scroll', scheduleScrollSave)
  window.removeEventListener('scroll', scheduleScrollSave)
  window.removeEventListener('pagehide', handlePageHide)
  if (previousScrollRestoration !== null) history.scrollRestoration = previousScrollRestoration
  for (const t of highlightTimeouts) clearTimeout(t)
  highlightTimeouts = []
})

function selectCollectionCategory(categoryId: number | null) {
  bookmarksStore.setActiveCategory(categoryId)
  // 平滑滚动到对应分类区块（不过滤，全部书签可见）
  nextTick(() => {
    const elId = categoryId === null ? 'bookmarks-list' : `folder-group-${categoryId}`
    const el = document.getElementById(elId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.style.transition = 'background-color 0.24s cubic-bezier(0.22, 1, 0.36, 1)'
      el.style.backgroundColor = 'var(--primary-light)'
      scheduleHighlightClear(() => { el.style.backgroundColor = '' }, 1200)
    }
  })
}

function selectFolder(id: number | null) {
  bookmarksStore.setCurrentFolder(id)
  if (import.meta.client) {
    nextTick(() => {
      const elId = id === null ? 'folder-group-recommended' : `folder-group-${id}`
      const el = document.getElementById(elId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        // 短暂高亮效果
        el.style.transition = 'background-color 0.24s cubic-bezier(0.22, 1, 0.36, 1)'
        el.style.backgroundColor = 'var(--primary-light)'
        scheduleHighlightClear(() => { el.style.backgroundColor = '' }, 1500)
      }
    })
  }
}

function showCreateFolder() {
  newFolderName.value = ''
  createFolderVisible.value = true
  nextTick(() => { createFolderInput.value?.focus() })
}

async function executeCreateFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  await bookmarksStore.createFolder({ name })
  createFolderVisible.value = false
}

function handleSearch(query: string) {
  searchQuery.value = query
}

function openEditDialog(bookmark: any) {
  editingBookmark.value = { ...bookmark }
  isNewBookmark.value = false
  editDialogVisible.value = true
}

function openAddDialog() {
  editingBookmark.value = { title: '', url: '', folder_id: null, icon: '' }
  isNewBookmark.value = true
  editDialogVisible.value = true
}

async function saveBookmark(data: any) {
  if (isNewBookmark.value) await bookmarksStore.createBookmark(data)
  else await bookmarksStore.updateBookmark(data.id, data)
  editDialogVisible.value = false
}

function confirmDelete(bookmark: any) {
  deletingBookmark.value = bookmark
  deleteConfirmVisible.value = true
}

async function executeDelete() {
  if (deletingBookmark.value) await bookmarksStore.deleteBookmark(deletingBookmark.value.id)
  deleteConfirmVisible.value = false
}

async function handleReorder(items: { id: number; sort_order: number }[]) {
  try {
    await bookmarksStore.reorderBookmarks(items)
  } catch (error) {
    // store 已在同一串行队列内完成 refetch；这里只记录，不发起第二次回滚。
    console.error('保存书签顺序失败，已在队列内恢复原顺序', error)
  }
}
</script>

<style scoped>
/* main 是 .home-shell 的 flex item，默认 min-width:auto 会被子元素 min-content
   （顶部分类导航条、精选集 tabs）撑到远超视口 → 移动端整页横向溢出、卡片被裁切。
   min-width:0 让它可以收缩到容器宽度，配合子级的 overflow-x:auto 横向滚动。 */
.home-shell > main {
  min-width: 0;
}

.page-footer-container {
  margin-top: auto;
  width: 100%;
}
.progress-wrap {
  text-align: center;
  padding: 1rem;
  border-top: 1px solid var(--border);
}
.page-footer {
  text-align: center;
  padding: 1rem;
  border-top: 1px solid var(--border);
  margin-top: auto;
}

.collection-tabs-container {
  display: flex;
  justify-content: center;
  padding: 16px 20px 0;
  /* flex item 默认 min-width:auto，会被子元素 min-content 撑破容器 → 移动端整页横向溢出 */
  min-width: 0;
  max-width: 100%;
}

.collection-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px;
  background: var(--surface-sunken);
  border-radius: 10px;
  max-width: 100%;
  min-width: 0;
}

.collection-tabs::-webkit-scrollbar {
  height: 4px;
}

.collection-tabs::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 6px;
}

.collection-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.12s cubic-bezier(0.22, 1, 0.36, 1), color 0.12s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
  white-space: nowrap;
  position: relative;
  text-decoration: none;
}

.collection-tab:hover {
  color: var(--text-primary);
  background: var(--primary-light);
}

.collection-tab:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.collection-tab:active {
  transform: scale(0.98);
}

.collection-tab.active {
  background: var(--surface-raised);
  color: var(--control-accent);
  box-shadow: var(--shadow-sm);
}

.collection-tab-market {
  color: var(--control-accent);
}

.collection-tab i {
  font-size: 16px;
}

.tab-icon {
  font-size: 16px;
}

.tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-inverse);
  background: var(--warning);
  border-radius: 10px;
  padding: 0 4px;
}

@media (max-width: 1024px) {
  .home-shell > main {
    padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  }
}

@media (max-width: 768px) {
  /* 手机端由 window 滚动；取消 main 的滚动容器以启用吸顶标题与位置恢复 */
  .home-shell > main {
    overflow: visible;
    min-height: 100vh;
  }
}

@media (max-width: 768px) {
  .collection-tabs-container {
    padding: 12px 16px 0;
  }

  .collection-tabs {
    gap: 6px;
    padding: 3px;
  }

  .collection-tab {
    padding: 6px 12px;
    font-size: 13px;
  }

  .tab-name {
    max-width: 80px;
  }
}
</style>

