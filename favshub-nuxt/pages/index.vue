<template>
  <div class="home-page flex">
    <!-- 壁纸背景 -->
    <WallpaperBackground />

    <!-- 侧边栏 -->
    <Sidebar
      :is-open="uiStore.sidebarOpen"
      :folders="bookmarksStore.folders"
      :current-folder-id="bookmarksStore.currentFolderId"
      :is-admin="authStore.isAdmin"
      :is-guest="authStore.isGuest"
      @toggle="uiStore.toggleSidebar()"
      @select-folder="selectFolder"
      @create-folder="showCreateFolder"
    />

    <!-- 主内容区 -->
    <main class="flex-1 bg-gray-50 p-8 overflow-auto flex flex-col">
      <!-- 欢迎消息 -->
      <WelcomeMessage v-if="settingsStore.get('showWelcomeMessage', true)" />

      <!-- 搜索栏 -->
      <div class="flex justify-between items-center mb-4">
        <SearchBar
          :engines="searchEngineStore.engines"
          :current-engine="searchEngineStore.currentEngine"
          :bookmarks="bookmarksStore.bookmarks"
          @search="handleSearch"
          @select-engine="searchEngineStore.setCurrentEngine"
        />
      </div>

      <!-- 书签网格 -->
      <BookmarkGrid
        :bookmarks="displayBookmarks"
        :is-loading="bookmarksStore.isLoading"
        :is-guest="authStore.isGuest"
        :bookmark-width="settingsStore.get('bookmarkWidth', 200)"
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
      <div v-if="deleteConfirmVisible" class="modal" @click.self="deleteConfirmVisible = false">
        <div class="modal-content">
          <h2>确认删除</h2>
          <p>确定要删除「{{ deletingBookmark?.title }}」吗？</p>
          <div class="buttons">
            <button class="cancel-button" @click="deleteConfirmVisible = false">取消</button>
            <button class="delete-button" @click="executeDelete">删除</button>
          </div>
        </div>
      </div>

      <!-- 年度进度条 -->
      <footer class="bg-gray-50 text-center p-4 border-t border-gray-200 mt-auto">
        <YearProgress />
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import Sidebar from '~/components/sidebar/Sidebar.vue'
import SearchBar from '~/components/search/SearchBar.vue'
import BookmarkGrid from '~/components/bookmark/BookmarkGrid.vue'
import BookmarkEditDialog from '~/components/bookmark/BookmarkEditDialog.vue'
import WelcomeMessage from '~/components/WelcomeMessage.vue'
import YearProgress from '~/components/YearProgress.vue'
import WallpaperBackground from '~/components/WallpaperBackground.vue'

const authStore = useAuthStore()
const bookmarksStore = useBookmarksStore()
const settingsStore = useSettingsStore()
const searchEngineStore = useSearchEnginesStore()
const uiStore = useUIStore()

// 编辑弹窗状态
const editDialogVisible = ref(false)
const isNewBookmark = ref(false)
const editingBookmark = ref<any>(null)

// 删除确认状态
const deleteConfirmVisible = ref(false)
const deletingBookmark = ref<any>(null)

// 搜索过滤
const searchQuery = ref('')
const displayBookmarks = computed(() => {
  if (!searchQuery.value) return bookmarksStore.filteredBookmarks
  const q = searchQuery.value.toLowerCase()
  return bookmarksStore.bookmarks.filter(b =>
    b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
  )
})

// 初始化加载
onMounted(async () => {
  await bookmarksStore.fetchBookmarks(authStore.token || undefined)
  await searchEngineStore.fetchEngines()
  await settingsStore.fetchSettings(authStore.token || undefined)
})

function selectFolder(id: number | null) {
  bookmarksStore.setCurrentFolder(id)
}

function showCreateFolder() {
  const name = prompt('请输入文件夹名称')
  if (name) {
    bookmarksStore.createFolder({ name })
  }
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
  if (isNewBookmark.value) {
    await bookmarksStore.createBookmark(data)
  } else {
    await bookmarksStore.updateBookmark(data.id, data)
  }
  editDialogVisible.value = false
}

function confirmDelete(bookmark: any) {
  deletingBookmark.value = bookmark
  deleteConfirmVisible.value = true
}

async function executeDelete() {
  if (deletingBookmark.value) {
    await bookmarksStore.deleteBookmark(deletingBookmark.value.id)
  }
  deleteConfirmVisible.value = false
}

async function handleReorder(items: { id: number; sort_order: number }[]) {
  await bookmarksStore.reorderBookmarks(items)
}
</script>

<style scoped>
.home-page {
  min-height: 100vh;
}
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  min-width: 300px;
  max-width: 90vw;
}
.modal-content h2 {
  margin: 0 0 12px;
  font-size: 18px;
}
.modal-content p {
  color: #666;
  margin-bottom: 20px;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.cancel-button {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.delete-button {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #e74c3c;
  color: #fff;
  cursor: pointer;
}
</style>
