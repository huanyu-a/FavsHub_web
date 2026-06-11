<template>
  <nav v-if="isMobile" class="mobile-bottom-nav">
    <NuxtLink to="/" class="mobile-nav-tab" @click="closeDrawer">
      <span class="mobile-nav-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      </span>
      <span class="mobile-nav-label">首页</span>
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

  <!-- Search bottom sheet -->
  <Teleport to="body">
    <div v-if="isMobile">
      <div class="mobile-search-backdrop" :class="{ active: searchSheetOpen }" @click="closeSearchSheet"></div>
      <div class="mobile-search-bottomsheet" :class="{ active: searchSheetOpen }">
        <button class="mobile-search-sheet-close" type="button" @click="closeSearchSheet">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="mobile-search-sheet-body">
          <form class="mobile-search-form" @submit.prevent="doSearch">
            <input
              ref="mobileSearchInput"
              v-model="mobileQuery"
              type="text"
              class="mobile-search-input"
              placeholder="搜索书签、提示词..."
              autofocus
            >
            <button type="submit" class="mobile-search-submit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
          </form>
          <!-- Search suggestions will be handled by the main SearchBar on desktop -->
          <!-- On mobile, we just perform the search directly -->
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const router = useRouter()
const { isMobile, drawerOpen, searchSheetOpen, closeDrawer, openSearchSheet, closeSearchSheet } = useMobile()

const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const mobileQuery = ref('')
const mobileSearchInput = ref<HTMLInputElement>()

function toggleTheme() {
  const current = settingsStore.settings.theme || 'light'
  const next = current === 'dark' ? 'light' : 'dark'
  if (authStore.token) settingsStore.updateSettings({ theme: next }, authStore.token)
  document.documentElement.setAttribute('data-theme', next)
}

function doSearch() {
  const q = mobileQuery.value.trim()
  if (!q) return
  // Save to history
  try {
    const raw = localStorage.getItem('favshub_search_history')
    let items: any[] = raw ? JSON.parse(raw) : []
    items = items.filter(i => i.text !== q)
    items.unshift({ text: q, url: '', type: 'search' })
    items = items.slice(0, 20)
    localStorage.setItem('favshub_search_history', JSON.stringify(items))
  } catch { /* ignore */ }
  // Open search in new tab
  const currentEngine = settingsStore.settings.defaultSearchEngine || 'https://www.google.com/search?q=%s'
  const url = currentEngine.replace('%s', encodeURIComponent(q))
  window.open(url, '_blank')
  closeSearchSheet()
  mobileQuery.value = ''
}

// Auto-focus input when sheet opens
watch(searchSheetOpen, (open) => {
  if (open) {
    nextTick(() => mobileSearchInput.value?.focus())
  }
})
</script>

<style scoped>
.mobile-search-form {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}
.mobile-search-input {
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  font-size: 16px;
  outline: none;
  transition: border-color 0.2s;
}
.mobile-search-input:focus {
  border-color: #667eea;
}
.mobile-search-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  background: #667eea;
  color: #fff;
  border-radius: 12px;
  cursor: pointer;
}
.mobile-search-submit:active {
  background: #5a6fd6;
}
</style>
