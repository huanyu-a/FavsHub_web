<template>
  <div class="home-page">
    <Sidebar
      :is-open="sidebarOpen"
      :folders="folders"
      :current-folder-id="currentFolderId"
      :is-admin="isAdmin"
      active-page="home"
      @toggle="toggleSidebar"
      @select-folder="selectFolder"
    />
    <main class="main-content" :style="{ marginLeft: sidebarOpen ? '220px' : '48px' }">
      <header class="content-header">
        <div class="header-left">
          <button class="sidebar-toggle-mobile" @click="toggleSidebar">☰</button>
          <h1 class="page-title">{{ currentFolderName }}</h1>
        </div>
        <div class="header-right">
          <SearchBar v-model="searchQuery" placeholder="搜索书签..." @search="onSearch" />
          <div v-if="isLoggedIn" class="user-info">
            <span class="username">{{ user?.username }}</span>
            <button class="btn-logout" @click="logout" title="登出">登出</button>
          </div>
          <NuxtLink v-else to="/login" class="btn-login">登录</NuxtLink>
        </div>
      </header>
      <BookmarkGrid :bookmarks="filteredBookmarks" :is-loading="isLoading" />
    </main>
  </div>
</template>

<script setup lang="ts">
import Sidebar from '~/components/sidebar/Sidebar.vue'
import SearchBar from '~/components/search/SearchBar.vue'
import BookmarkGrid from '~/components/bookmark/BookmarkGrid.vue'
import { useBookmarksStore } from '~/stores/bookmarks'
import { useUIStore } from '~/stores/ui'

const bookmarksStore = useBookmarksStore()
const uiStore = useUIStore()
const { isLoggedIn, isAdmin, user, token, logout } = useAuth()

const sidebarOpen = computed(() => uiStore.sidebarOpen)
const folders = computed(() => bookmarksStore.visibleFolders)
const currentFolderId = computed(() => bookmarksStore.currentFolderId)
const filteredBookmarks = computed(() => bookmarksStore.filteredBookmarks)
const isLoading = computed(() => bookmarksStore.isLoading)
const searchQuery = computed({
  get: () => bookmarksStore.searchQuery,
  set: (v: string) => bookmarksStore.setSearchQuery(v),
})

const currentFolderName = computed(() => {
  if (currentFolderId.value === null) return '全部书签'
  const folder = folders.value.find((f) => f.id === currentFolderId.value)
  return folder ? folder.name : '全部书签'
})

function toggleSidebar() {
  uiStore.toggleSidebar()
}

function selectFolder(id: number) {
  bookmarksStore.setCurrentFolder(id === currentFolderId.value ? null : id)
}

function onSearch(query: string) {
  bookmarksStore.setSearchQuery(query)
}

onMounted(async () => {
  if (isLoggedIn.value) {
    await bookmarksStore.fetchBookmarks(token.value || undefined)
  }
})

watch(isLoggedIn, async (val) => {
  if (val) {
    await bookmarksStore.fetchBookmarks(token.value || undefined)
  }
})
</script>

<style scoped>
.home-page {
  display: flex;
  min-height: 100vh;
  background: #fafafa;
}
.main-content {
  flex: 1;
  transition: margin-left 0.2s;
  min-width: 0;
}
.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  position: sticky;
  top: 0;
  z-index: 10;
  gap: 12px;
  flex-wrap: wrap;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  max-width: 500px;
  justify-content: flex-end;
}
.page-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: #333;
}
.sidebar-toggle-mobile {
  display: none;
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
  color: #666;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.username {
  font-size: 13px;
  color: #555;
}
.btn-logout {
  background: none;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  color: #666;
}
.btn-logout:hover {
  border-color: #e53935;
  color: #e53935;
}
.btn-login {
  font-size: 13px;
  color: #1976d2;
  text-decoration: none;
  padding: 4px 10px;
  border: 1px solid #1976d2;
  border-radius: 6px;
}
.btn-login:hover {
  background: #e3f2fd;
}
@media (max-width: 768px) {
  .sidebar-toggle-mobile {
    display: block;
  }
  .header-right {
    max-width: 100%;
    width: 100%;
  }
}
@media (prefers-color-scheme: dark) {
  .home-page {
    background: #121212;
  }
  .content-header {
    background: #1e1e1e;
    border-bottom-color: #333;
  }
  .page-title {
    color: #eee;
  }
  .sidebar-toggle-mobile {
    color: #aaa;
  }
  .username {
    color: #bbb;
  }
  .btn-logout {
    border-color: #555;
    color: #aaa;
  }
  .btn-logout:hover {
    border-color: #ef5350;
    color: #ef5350;
  }
  .btn-login {
    color: #64b5f6;
    border-color: #64b5f6;
  }
  .btn-login:hover {
    background: #1a3a5c;
  }
}
</style>
