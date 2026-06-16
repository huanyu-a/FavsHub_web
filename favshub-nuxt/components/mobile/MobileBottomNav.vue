<template>
  <nav v-if="isMobile" class="mobile-bottom-nav">
    <NuxtLink v-if="isPromptsPage" to="/" class="mobile-nav-item" @click="closeDrawer">
      <span class="mobile-nav-icon">🏠</span>
      <span class="mobile-nav-label">首页</span>
    </NuxtLink>
    <NuxtLink v-else to="/prompts" class="mobile-nav-item" @click="closeDrawer">
      <span class="mobile-nav-icon">💬</span>
      <span class="mobile-nav-label">提示词</span>
    </NuxtLink>
    <button class="mobile-nav-item" type="button" @click="toggleFolderPanel">
      <span class="mobile-nav-icon">📂</span>
      <span class="mobile-nav-label">分类</span>
    </button>
    <button class="mobile-nav-item" type="button" @click="openSearchSheet">
      <span class="mobile-nav-icon">🔍</span>
      <span class="mobile-nav-label">搜索</span>
    </button>
    <button class="mobile-nav-item" type="button" @click="toggleTheme">
      <span class="mobile-nav-icon">{{ themeIcon }}</span>
      <span class="mobile-nav-label">主题</span>
    </button>
    <NuxtLink to="/admin" class="mobile-nav-item">
      <span class="mobile-nav-icon">👤</span>
      <span class="mobile-nav-label">我的</span>
    </NuxtLink>
  </nav>

  <!-- 分类悬浮列表 -->
  <Teleport to="body">
    <div v-if="isMobile && showFolderPanel" class="mobile-folder-overlay" @click="showFolderPanel = false"></div>
    <Transition name="folder-float">
      <div v-if="isMobile && showFolderPanel" class="mobile-folder-float">
        <div class="mobile-folder-item" @click="selectFolder('all')">
          <span class="mobile-folder-icon">📁</span>
          <span class="mobile-folder-name">全部</span>
        </div>
        <!-- 一级分类 -->
        <template v-for="folder in rootFolders" :key="folder.id">
          <div
            class="mobile-folder-item"
            :class="{ active: expandedFolderId === folder.id }"
            @click="toggleExpandFolder(folder.id)"
          >
            <span class="mobile-folder-icon">{{ folder.icon || '📂' }}</span>
            <span class="mobile-folder-name">{{ folder.name }}</span>
            <span v-if="folder.login_required" title="登录可见" style="font-size:10px;">🔒</span>
          </div>
          <!-- 二级分类 -->
          <Transition name="folder-sub">
            <div v-if="expandedFolderId === folder.id && hasChildren(folder.id)" class="mobile-folder-sub">
              <div
                v-for="child in getChildFolders(folder.id)"
                :key="child.id"
                class="mobile-folder-item sub"
                @click="selectFolder(child.id)"
              >
                <span class="mobile-folder-icon sub">{{ child.icon || '📄' }}</span>
                <span class="mobile-folder-name">{{ child.name }}</span>
              </div>
            </div>
          </Transition>
        </template>
      </div>
    </Transition>
  </Teleport>

  <!-- Search bottom sheet with full SearchBar -->
  <Teleport to="body">
    <div v-if="isMobile">
      <div class="mobile-search-backdrop" :class="{ active: searchSheetOpen }" @click="closeSearchSheet"></div>
      <div class="mobile-search-bottomsheet" :class="{ active: searchSheetOpen }">
        <button class="mobile-search-sheet-close" type="button" @click="closeSearchSheet">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="mobile-search-sheet-body" v-if="searchSheetOpen">
          <SearchBar
            :engines="searchEngineStore.defaultEngines.length > 0 ? searchEngineStore.defaultEngines : searchEngineStore.engines"
            :all-engines="searchEngineStore.engines"
            :current-engine="searchEngineStore.currentEngine"
            :bookmarks="bookmarksStore.bookmarks"
            :mobile="true"
            @select-engine="(id) => searchEngineStore.setCurrentEngine(id)"
            @search="closeSearchSheet"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import SearchBar from '~/components/search/SearchBar.vue'

const router = useRouter()
const route = useRoute()
const { isMobile, drawerOpen, searchSheetOpen, closeDrawer, openSearchSheet, closeSearchSheet } = useMobile()

const isPromptsPage = computed(() => route.path.startsWith('/prompts'))

// Mobile search: reuse same stores as desktop SearchBar
const uiStore = useUIStore()
const searchEngineStore = useSearchEnginesStore()
const bookmarksStore = useBookmarksStore()
const authStore = useAuthStore()

// 分类面板
const showFolderPanel = ref(false)
const expandedFolderId = ref<number | null>(null)
const promptFolders = ref<any[]>([])

// 提示词页文件夹筛选状态（共享）
const activePromptFolderId = useState<string | null>('activePromptFolderId', () => null)

const folders = computed(() => {
  if (isPromptsPage.value) {
    return promptFolders.value
  }
  return bookmarksStore.folders
})

// 一级分类（parent_id 为 null）
const rootFolders = computed(() => folders.value.filter(f => !f.parent_id))

// 加载提示词文件夹
async function loadPromptFolders() {
  if (!isPromptsPage.value) return
  try {
    const data = await $fetch<{ folders: any[] }>('/api/prompts/folders/all')
    promptFolders.value = data?.folders || []
  } catch {
    promptFolders.value = []
  }
}

// 监听页面变化，加载对应的文件夹
watch(isPromptsPage, (isPrompts) => {
  if (isPrompts) {
    loadPromptFolders()
  }
}, { immediate: true })

// 检查是否有子分类
function hasChildren(folderId: number): boolean {
  return folders.value.some(f => f.parent_id === folderId)
}

// 获取子分类
function getChildFolders(parentId: number) {
  return folders.value.filter(f => f.parent_id === parentId)
}

// 展开/收起二级分类
function toggleExpandFolder(folderId: number) {
  if (expandedFolderId.value === folderId) {
    expandedFolderId.value = null
  } else {
    expandedFolderId.value = folderId
    // 如果没有子分类，直接筛选
    if (!hasChildren(folderId)) {
      selectFolder(folderId)
    }
  }
}

function toggleFolderPanel() {
  showFolderPanel.value = !showFolderPanel.value
  expandedFolderId.value = null
}

function selectFolder(folderId: number | 'all') {
  showFolderPanel.value = false

  if (isPromptsPage.value) {
    // 提示词页：使用共享状态筛选
    activePromptFolderId.value = folderId === 'all' ? null : String(folderId)
  } else {
    // 首页：使用 bookmarksStore 筛选 + 滚动到对应板块
    bookmarksStore.setCurrentFolder(folderId === 'all' ? null : folderId)
    if (import.meta.client) {
      nextTick(() => {
        const elId = folderId === 'all' ? 'folder-group-recommended' : `folder-group-${folderId}`
        const el = document.getElementById(elId)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
    }
  }
}

// Load bookmarks if not loaded
onMounted(() => {
  if (authStore.token && bookmarksStore.bookmarks.length === 0) {
    bookmarksStore.fetchBookmarks(authStore.token)
  }
  searchEngineStore.fetchEngines()
})

const themeIcon = computed(() => uiStore.theme === 'dark' ? '🌙' : '☀️')

function toggleTheme() {
  const next = uiStore.theme === 'dark' ? 'light' : 'dark'
  uiStore.setTheme(next)
}
</script>

