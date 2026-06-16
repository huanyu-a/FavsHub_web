<template>
  <nav v-if="isMobile" class="mobile-bottom-nav">
    <NuxtLink v-if="isPromptsPage" to="/" class="mobile-nav-tab" @click="closeDrawer">
      <span class="mobile-nav-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      </span>
      <span class="mobile-nav-label">首页</span>
    </NuxtLink>
    <NuxtLink v-else to="/prompts" class="mobile-nav-tab" @click="closeDrawer">
      <span class="mobile-nav-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
      </span>
      <span class="mobile-nav-label">提示词</span>
    </NuxtLink>
    <button class="mobile-nav-tab" type="button" @click="openSearchSheet">
      <span class="mobile-nav-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </span>
      <span class="mobile-nav-label">搜索</span>
    </button>
    <button class="mobile-nav-tab" type="button" @click="toggleTheme">
      <span class="mobile-nav-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
      </span>
      <span class="mobile-nav-label">主题</span>
    </button>
    <NuxtLink to="/admin" class="mobile-nav-tab">
      <span class="mobile-nav-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
      </span>
      <span class="mobile-nav-label">管理</span>
    </NuxtLink>
  </nav>

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

// Load bookmarks if not loaded
onMounted(() => {
  if (authStore.token && bookmarksStore.bookmarks.length === 0) {
    bookmarksStore.fetchBookmarks(authStore.token)
  }
  searchEngineStore.fetchEngines()
})

function toggleTheme() {
  const next = uiStore.theme === 'dark' ? 'light' : 'dark'
  uiStore.setTheme(next)
}
</script>

