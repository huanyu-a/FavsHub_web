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

    <!-- 主内容区 -->
    <main class="flex-1 bg-gray-50 overflow-auto flex flex-col">
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
            <span class="tab-icon">{{ col.icon || '📚' }}</span>
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

      <!-- 页脚：年度进度条 -->
      <footer v-if="settingsStore.get('showFooter', true)" class="page-footer">
        <YearProgress />
      </footer>
    </main>

    <!-- 侧边栏切换按钮 -->
    <button id="toggle-sidebar" @click="uiStore.toggleSidebar()" title="收起/展开侧边栏">
      {{ uiStore.sidebarOpen ? '<' : '>' }}
    </button>

    <!-- 回到顶部按钮 -->
    <BackToTop />

  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' })

import Sidebar from '~/components/sidebar/Sidebar.vue'
import SearchBar from '~/components/search/SearchBar.vue'
import BookmarkGrid from '~/components/bookmark/BookmarkGrid.vue'
import BookmarkEditDialog from '~/components/bookmark/BookmarkEditDialog.vue'
import WelcomeMessage from '~/components/WelcomeMessage.vue'
import YearProgress from '~/components/YearProgress.vue'
import BackToTop from '~/components/BackToTop.vue'

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

const { data: bookmarksData } = await useFetch('/api/bookmarks', {
  headers: authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {},
  credentials: 'include',
})
const { data: enginesData } = await useFetch('/api/search-engines')
const { data: settingsData } = await useFetch('/api/settings', {
  headers: authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {},
  credentials: 'include',
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

// 按 collection_id 加载精选集书签（直接从 collection_bookmarks 表读取）
async function loadCollectionBookmarks(collectionId: string) {
  bookmarksStore.isLoading = true
  try {
    await bookmarksStore.fetchCollectionData(collectionId)
    bookmarksStore.setCurrentCollection(collectionId)
  } catch (err) {
    console.error('加载精选集书签失败', err)
  } finally {
    bookmarksStore.isLoading = false
  }
}

// 监听精选集切换，加载对应书签
watch(currentCollectionId, async (newId, oldId) => {
  if (newId) {
    await loadCollectionBookmarks(newId)
  } else if (oldId) {
    // 从精选集切换回全部书签时重置
    bookmarksStore.setCurrentCollection(null)
    await bookmarksStore.fetchBookmarks()
  }
})

// SSR hydration 后检查 URL 是否带有 collection 参数，加载对应书签
onMounted(async () => {
  if (authStore.isLoggedIn) {
    await bookmarksStore.fetchMyCollections()
  }
  // 如果 URL 带有 collection 参数，立即加载对应精选集书签
  if (currentCollectionId.value) {
    await loadCollectionBookmarks(currentCollectionId.value)
  }
})

function selectCollection(id: string) {
  router.push({ query: { collection: id } })
}

function selectCollectionCategory(categoryId: number | null) {
  bookmarksStore.setActiveCategory(categoryId)
  // 平滑滚动到对应分类区块（不过滤，全部书签可见）
  nextTick(() => {
    const elId = categoryId === null ? 'bookmarks-list' : `folder-group-${categoryId}`
    const el = document.getElementById(elId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.style.transition = 'background-color 0.3s'
      el.style.backgroundColor = 'rgba(16, 185, 129, 0.06)'
      setTimeout(() => { el.style.backgroundColor = '' }, 1200)
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
        el.style.transition = 'background-color 0.3s'
        el.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'
        setTimeout(() => { el.style.backgroundColor = '' }, 1500)
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
  await bookmarksStore.reorderBookmarks(items)
}
</script>

<style scoped>
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
}

.collection-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px;
  background: var(--bg-secondary, #f3f4f6);
  border-radius: 12px;
  max-width: 100%;
}

.collection-tabs::-webkit-scrollbar {
  height: 4px;
}

.collection-tabs::-webkit-scrollbar-thumb {
  background: var(--border, #e5e7eb);
  border-radius: 2px;
}

.collection-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  position: relative;
  text-decoration: none;
}

.collection-tab:hover {
  color: var(--text-primary, #111827);
  background: color-mix(in srgb, var(--primary, #10b981) 5%, transparent);
}

.collection-tab.active {
  background: var(--bg-primary, #fff);
  color: var(--primary, #10b981);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.collection-tab-market {
  color: var(--primary, #10b981);
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
  color: #fff;
  background: #f59e0b;
  border-radius: 9px;
  padding: 0 4px;
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

