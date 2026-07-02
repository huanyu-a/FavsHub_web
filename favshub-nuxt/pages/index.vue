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
      @toggle="uiStore.toggleSidebar()"
      @select-folder="selectFolder"
      @create-folder="showCreateFolder"
    />

    <!-- 主内容区 -->
    <main class="flex-1 bg-gray-50 overflow-auto flex flex-col">
      <!-- 欢迎消息 -->
      <WelcomeMessage v-if="settingsStore.get('showWelcomeMessage', true)" />

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

      <!-- 书签网格 -->
      <BookmarkGrid
        :bookmarks="displayBookmarks"
        :folders="bookmarksStore.folders"
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

const editDialogVisible = ref(false)
const isNewBookmark = ref(false)
const editingBookmark = ref<any>(null)

const deleteConfirmVisible = ref(false)
const deletingBookmark = ref<any>(null)

const searchQuery = ref('')
const displayBookmarks = computed(() => {
  let result = bookmarksStore.bookmarks
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(b =>
      b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
    )
  }
  return result
})

// ── SSR 数据预取 + 客户端 hydration ──────────────────────
// 使用 useFetch 而非 store 的 $fetch，确保 SSR 正确转发请求上下文

const { data: bookmarksData } = await useFetch('/api/bookmarks', {
  headers: authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {},
})
const { data: enginesData } = await useFetch('/api/search-engines')
const { data: settingsData } = await useFetch('/api/settings', {
  headers: authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {},
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
  const name = prompt('请输入文件夹名称')
  if (name) bookmarksStore.createFolder({ name })
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
  background: var(--surface-sunken);
  text-align: center;
  padding: 1rem;
  border-top: 1px solid var(--border);
  margin-top: auto;
}
</style>

