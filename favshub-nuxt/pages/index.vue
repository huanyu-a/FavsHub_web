<template>
  <div class="home-shell">
    <!-- 壁纸背景 -->
    <WallpaperBackground />

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
        :bookmark-width="settingsStore.get('bookmarkWidth', 200)"
        :bookmark-card-height="settingsStore.get('bookmarkCardHeight', 50)"
        :bookmark-container-width="settingsStore.get('bookmarkContainerWidth', 85)"
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
      <footer v-if="settingsStore.get('showFooter', true)" class="bg-gray-50 text-center p-4 border-t border-gray-200 mt-auto">
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
import WallpaperBackground from '~/components/WallpaperBackground.vue'
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

onMounted(async () => {
  await bookmarksStore.fetchBookmarks(authStore.token || undefined)
  await searchEngineStore.fetchEngines()
  await settingsStore.fetchSettings(authStore.token || undefined)
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
/* 整体布局：body.h-screen.flex.flex-col 行为；这里用 .home-shell 承载 */
.home-shell {
  height: 100vh;
  display: flex;
  position: relative;
  overflow: hidden;
}
.home-shell > main {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

/* 删除确认弹窗复用 main-bundle.css 的 .modal/.modal-content；补充按钮容器 */
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* 平板及以下：清除 main-bundle.css 的 margin-left:auto 防止主页被推出视口 */
@media (max-width: 1024px) {
  .home-shell > main {
    margin-left: 0 !important;
  }
}

/* 移动端适配 */
@media (max-width: 768px) {
  .home-shell {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }
  /* 控制书签图标大小 */
  .home-shell :deep(.bookmark-card .favicon img) {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .home-shell :deep(.bookmark-card .card-icon-text) {
    width: 24px;
    height: 24px;
    font-size: 14px;
    flex-shrink: 0;
  }
}
</style>
