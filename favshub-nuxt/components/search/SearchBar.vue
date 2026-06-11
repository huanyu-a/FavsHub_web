<template>
  <div class="search-container">
    <form
      class="search-form"
      id="search-form"
      :class="{ 'focused-with-suggestions': showSuggestions && filteredSuggestions.length > 0 }"
      @submit.prevent="handleSearch()"
    >
      <div style="position: relative; height: auto;">
        <div class="search-icon-container" title="切换搜索引擎" @click="toggleDropdown">
          <img
            :src="currentEngine?.icon || '/images/placeholder-icon.svg'"
            :alt="currentEngine?.name || 'search-engine-icon'"
            class="search-engine-icon"
          >
          <span class="dropdown-indicator">▼</span>
        </div>
        <textarea
          ref="inputRef"
          v-model="query"
          class="search-input"
          placeholder="按 Enter 键搜索，或按 Cmd/Ctrl + Enter 键搜索所有搜索引擎"
          rows="1"
          style="width: 100%; resize: none; padding-left: 40px;"
          @keydown="handleKeydown"
          @input="onInput"
          @focus="onFocus"
          @blur="hideSuggestionsDelayed"
        ></textarea>

        <!-- 搜索引擎下拉 -->
        <SearchEngineDropdown
          :engines="engines"
          :visible="showDropdown"
          @select="selectEngine"
          @manage="openEngineDialog"
        />
      </div>

      <!-- 搜索建议区域（匹配旧版 .search-suggestions-wrapper） -->
      <div class="search-suggestions-wrapper" :style="{ display: showSuggestions && filteredSuggestions.length > 0 ? 'block' : 'none' }">
        <div class="line-container" id="line-container">
          <hr class="custom-hr">
        </div>
        <div class="category-tabs" id="category-tabs">
          <span
            v-for="tab in availableTabs"
            :key="tab.key"
            class="category-tab"
            :class="{ active: activeTab === tab.key }"
            @mousedown.prevent="activeTab = tab.key"
          >{{ tab.label }}</span>
        </div>
        <ul id="search-suggestions" class="search-suggestions">
          <li
            v-for="(s, i) in filteredSuggestions"
            :key="i"
            :data-type="s.type"
            :class="{ 'keyboard-selected': keyboardIndex === i }"
            @mousedown.prevent="applySuggestion(s)"
          >
            <span class="suggestion-icon">
              <img v-if="s.icon" :src="s.icon" alt="" class="favicon" @error="(e) => ((e.target as HTMLElement).style.display = 'none')">
              <template v-else-if="s.type === 'prompt'">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </template>
              <template v-else-if="s.type === 'history'">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </template>
              <template v-else>
                <i class="ri-bookmark-line" style="font-size:14px;color:#999;"></i>
              </template>
            </span>
            <span class="suggestion-text">{{ s.text }}</span>
            <span class="suggestion-dash" v-if="s.url && s.type !== 'search'">-</span>
            <span class="suggestion-url">{{ s.url ? formatUrl(s.url) : '' }}</span>
            <span class="suggestion-type">{{ typeLabel(s.type) }}</span>
          </li>
        </ul>
        <div id="tabs-container" class="tabs" v-if="(allEngines || engines).length > 0">
          <span class="search-tips">本次使用</span>
          <span
            v-for="engine in (allEngines || engines)"
            :key="engine.id"
            class="tab"
            :class="{ active: currentEngine?.id === engine.id }"
            :data-engine="engine.name"
            @mousedown.prevent="searchWithEngine(engine)"
          >
            {{ engine.label || engine.name }}
          </span>
        </div>
      </div>
    </form>

    <!-- 搜索引擎管理弹窗（复用旧版 #search-engines-dialog 结构） -->
    <Teleport to="body">
      <div id="search-engines-dialog" class="engine-dialog-overlay" :class="{ visible: showEngineDialog }" v-if="showEngineDialog" @click.self="closeEngineDialog">
        <div class="engine-dialog-content">
          <span class="engine-dialog-close" @click="closeEngineDialog">&times;</span>
          <h2 class="engine-dialog-title">搜索引擎设置</h2>
          <div class="engine-dialog-body">
            <div v-for="cat in engineCategories" :key="cat.key" class="engine-dialog-category">
              <h3 class="engine-dialog-category-title">{{ cat.label }}</h3>
              <div class="engine-dialog-grid">
                <label
                  v-for="engine in cat.engines"
                  :key="engine.id"
                  class="engine-dialog-item"
                  :class="{ selected: enabledEngineIds.has(engine.id) }"
                >
                  <input
                    type="checkbox"
                    :checked="enabledEngineIds.has(engine.id)"
                    @change="toggleEngine(engine)"
                  >
                  <div class="engine-dialog-item-content">
                    <img :src="engine.icon || '/images/placeholder-icon.svg'" :alt="engine.name" class="engine-dialog-item-icon">
                    <span class="engine-dialog-item-name">{{ engine.label || engine.name }}</span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import SearchEngineDropdown from './SearchEngineDropdown.vue'
import { useSettingsStore } from '~/stores/settings'
import { useSearchEnginesStore } from '~/stores/searchEngines'

const settingsStore = useSettingsStore()
const searchEngineStore = useSearchEnginesStore()

interface Engine {
  id: number
  name: string
  label?: string
  url: string
  icon?: string | null
  category?: string
}

interface Bookmark {
  id: number
  title: string
  url: string
  icon?: string | null
}

interface Prompt {
  id: string
  title: string
  description?: string
  content?: string
  prompt_id?: string
}

interface SuggestionItem {
  text: string
  url: string
  type: 'search' | 'bookmark' | 'prompt' | 'history'
  icon?: string
  relevance?: number
  rawData?: any
}

const props = defineProps<{
  engines: Engine[]
  allEngines?: Engine[]
  currentEngine: Engine | null
  bookmarks: Bookmark[]
}>()

const emit = defineEmits<{
  search: [query: string]
  'select-engine': [id: number]
}>()

const inputRef = ref<HTMLTextAreaElement | null>(null)
const query = ref('')
const showDropdown = ref(false)
const showSuggestions = ref(false)
const showEngineDialog = ref(false)
const enabledEngineIds = ref(new Set<number>())
const activeTab = ref('all')
const keyboardIndex = ref(-1)

// Prompt suggestions fetched from API
const promptSuggestions = ref<SuggestionItem[]>([])

// Search history from localStorage
const searchHistory = ref<SuggestionItem[]>([])

const HISTORY_KEY = 'favshub_search_history'
const MAX_HISTORY = 20

// ── Engine categories for dialog ────────────────────────────────
const engineCategories = computed(() => {
  const source = props.allEngines || props.engines
  const cats: Record<string, { key: string; label: string; engines: Engine[] }> = {
    SEARCH: { key: 'SEARCH', label: '通用搜索', engines: [] },
    AI: { key: 'AI', label: 'AI 搜索', engines: [] },
    SOCIAL: { key: 'SOCIAL', label: '社交媒体', engines: [] },
  }
  for (const e of source) {
    const cat = e.category || 'SEARCH'
    if (cats[cat]) cats[cat].engines.push(e)
  }
  return Object.values(cats).filter(c => c.engines.length > 0)
})

watch(() => props.allEngines || props.engines, (engines) => {
  enabledEngineIds.value = new Set(
    engines.filter(e => (e as any).is_default === 1 || (e as any).is_default === true).map(e => e.id)
  )
}, { immediate: true })

// ── Load prompt suggestions from API ────────────────────────────
async function loadPromptSuggestions(search?: string) {
  try {
    const params: Record<string, string> = { limit: '10' }
    if (search) params.search = search
    const queryStr = new URLSearchParams(params).toString()
    const data = await $fetch<{ prompts: Prompt[] }>(`/api/prompts?${queryStr}`)
    if (data?.prompts) {
      promptSuggestions.value = data.prompts.map(p => ({
        text: p.title,
        url: `promptpro://detail/${p.prompt_id || p.id}`,
        type: 'prompt' as const,
        relevance: 0.5,
        rawData: p,
      }))
    }
  } catch {
    promptSuggestions.value = []
  }
}

// ── Search history (localStorage) ───────────────────────────────
function loadHistory() {
  if (!import.meta.client) return
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw) {
      const items = JSON.parse(raw) as SuggestionItem[]
      searchHistory.value = items.map(item => ({ ...item, type: 'history' as const }))
    }
  } catch {
    searchHistory.value = []
  }
}

function saveToHistory(text: string, url?: string) {
  if (!import.meta.client || !text.trim()) return
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    let items: SuggestionItem[] = raw ? JSON.parse(raw) : []
    // Remove duplicate
    items = items.filter(i => i.text !== text)
    // Add to front
    items.unshift({ text, url: url || '', type: 'search' })
    // Trim to max
    items = items.slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items))
    loadHistory()
  } catch { /* ignore */ }
}

// ── Browser history via extension ──────────────────────────────
function sendExtensionMessage(action: string, extraParams: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve) => {
    const requestId = Date.now().toString() + Math.random().toString(36).slice(2)
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'favshub-ext-response' && event.data?.requestId === requestId) {
        window.removeEventListener('message', handler)
        resolve(event.data.payload)
      }
    }
    window.addEventListener('message', handler)
    window.postMessage({ type: 'favshub-ext-request', action, requestId, ...extraParams }, '*')
    setTimeout(() => { window.removeEventListener('message', handler); resolve(null) }, 3000)
  })
}

async function loadBrowserHistory(query?: string) {
  if (!import.meta.client) return
  if (document.documentElement.getAttribute('data-favshub-ext') !== 'active') return

  try {
    const params: Record<string, any> = { maxResults: query ? 200 : 100 * 20 }
    if (query) params.startTime = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days
    const res = await sendExtensionMessage('searchHistory', { text: query || '', ...params })
    if (!res?.success || !res.items?.length) return

    // Deduplicate by URL, limit per domain
    const domainCounts: Record<string, number> = {}
    const uniqueItems = new Map<string, SuggestionItem>()
    const now = Date.now()

    for (const item of res.items) {
      let domain = ''
      try { domain = new URL(item.url).hostname } catch { /* skip invalid */ }
      if (!domain || !item.url) continue

      const key = `${item.url}|${item.title || ''}`
      if (uniqueItems.has(key)) continue
      domainCounts[domain] = (domainCounts[domain] || 0) + 1
      if (domainCounts[domain] > 5) continue

      uniqueItems.set(key, {
        text: item.title || item.url,
        url: item.url,
        type: 'history' as const,
        icon: '',
        relevance: Math.exp(-((now - (item.lastVisitTime || now)) / (1000 * 60 * 60 * 24)) / 7), // 7-day half-life
      })
    }

    const browserHistory = Array.from(uniqueItems.values())
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .slice(0, query ? 20 : 10)

    // Merge: localStorage history first, then browser history (dedup by text)
    const existing = searchHistory.value
    const seenTexts = new Set(existing.map(h => h.text))
    const merged = [...existing]
    for (const h of browserHistory) {
      if (!seenTexts.has(h.text)) {
        merged.push(h)
        seenTexts.add(h.text)
      }
    }
    searchHistory.value = merged
  } catch { /* silent */ }
}

function clearHistory() {
  if (!import.meta.client) return
  localStorage.removeItem(HISTORY_KEY)
  searchHistory.value = []
}

// ── Bookmark suggestions (from props) ───────────────────────────
const bookmarkSuggestions = computed<SuggestionItem[]>(() => {
  if (!props.bookmarks || props.bookmarks.length === 0) return []
  return props.bookmarks
    .filter(b => b.title && b.url)
    .slice(0, 10)
    .map(b => ({
      text: b.title,
      url: b.url,
      type: 'bookmark' as const,
      icon: b.icon || '',
      relevance: 1,
    }))
})

// ── Multi-word match helper ────────────────────────────────────
// Split query by spaces; each word must appear in at least one field (AND logic across words)
function multiWordMatch(text: string, words: string[]): boolean {
  const lower = text.toLowerCase()
  return words.every(w => lower.includes(w))
}

// ── Per-type raw results (no limits) ───────────────────────────
function getRawResults(): { history: SuggestionItem[], bookmarks: SuggestionItem[], prompts: SuggestionItem[] } {
  const showHistory = settingsStore.settings.showHistorySuggestions ?? true
  const showBookmarks = settingsStore.settings.showBookmarkSuggestions ?? true
  const showPrompts = settingsStore.settings.showPromptSuggestions ?? true

  const q = query.value.trim().toLowerCase()
  const words = q ? q.split(/\s+/).filter(Boolean) : []

  // History
  const history: SuggestionItem[] = showHistory
    ? (q
        ? searchHistory.value.filter(h => multiWordMatch(h.text, words)).map(h => ({ ...h, relevance: 3 }))
        : searchHistory.value)
    : []

  // Bookmarks
  const bookmarks: SuggestionItem[] = showBookmarks
    ? (q
        ? props.bookmarks
            .filter(b => b.title && b.url && (multiWordMatch(b.title, words) || multiWordMatch(b.url, words)))
            .map(b => ({ text: b.title, url: b.url, type: 'bookmark' as const, icon: b.icon || '', relevance: 2 }))
        : bookmarkSuggestions.value)
    : []

  // Prompts
  const prompts: SuggestionItem[] = showPrompts
    ? (q
        ? promptSuggestions.value.filter(p => multiWordMatch(p.text, words)).map(p => ({ ...p, relevance: 1 }))
        : promptSuggestions.value)
    : []

  return { history, bookmarks, prompts }
}

// ── Combined suggestions (for tab availability + 'all' tab preview) ─
const allSuggestions = computed<SuggestionItem[]>(() => {
  const showAll = settingsStore.settings.showSearchSuggestions ?? true
  if (!showAll) return []

  const { history, bookmarks, prompts } = getRawResults()
  // 'All' tab: limited preview per type
  const items: SuggestionItem[] = [
    ...bookmarks.slice(0, 8),
    ...prompts.slice(0, 5),
    ...history.filter(h => h.url).slice(0, 5),
  ]

  // Deduplicate by text
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.text)) return false
    seen.add(item.text)
    return true
  })
})

// ── Tab filtering ───────────────────────────────────────────────
const availableTabs = computed(() => {
  const { history, bookmarks, prompts } = getRawResults()
  const tabs = [{ key: 'all', label: '全部' }]
  if (history.length) tabs.push({ key: 'history', label: `历史(${history.length})` })
  if (bookmarks.length) tabs.push({ key: 'bookmark', label: `书签(${bookmarks.length})` })
  if (prompts.length) tabs.push({ key: 'prompt', label: `提示词(${prompts.length})` })
  return tabs
})

const filteredSuggestions = computed(() => {
  if (activeTab.value === 'all') return allSuggestions.value
  const { history, bookmarks, prompts } = getRawResults()
  const seen = new Set<string>()
  let items: SuggestionItem[] = []
  if (activeTab.value === 'history') items = history.filter(h => h.url)
  else if (activeTab.value === 'bookmark') items = bookmarks
  else if (activeTab.value === 'prompt') items = prompts
  return items.filter(item => {
    if (seen.has(item.text)) return false
    seen.add(item.text)
    return true
  })
})

// ── Format helpers ──────────────────────────────────────────────
function formatUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    return url
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case 'prompt': return '提示词'
    case 'bookmark': return '书签'
    case 'history': return '历史'
    default: return ''
  }
}

// ── Actions ─────────────────────────────────────────────────────
function toggleDropdown() {
  showDropdown.value = !showDropdown.value
}

function selectEngine(engine: Engine) {
  emit('select-engine', engine.id)
  showDropdown.value = false
}

function openEngineDialog() {
  showDropdown.value = false
  showEngineDialog.value = true
}

function closeEngineDialog() {
  showEngineDialog.value = false
  searchEngineStore.fetchEngines()
}

function handleSearch(e?: Event) {
  const kbEvent = e instanceof KeyboardEvent ? e : undefined
  const searchText = query.value.trim()
  if (!searchText) return

  const engine = props.currentEngine
  if (kbEvent?.metaKey || kbEvent?.ctrlKey) {
    (props.allEngines || props.engines).forEach(eng => {
      if (eng.url) window.open(eng.url.replace('%s', encodeURIComponent(searchText)), '_blank')
    })
  } else if (engine?.url) {
    window.open(engine.url.replace('%s', encodeURIComponent(searchText)), '_blank')
  }
  saveToHistory(searchText)
  emit('search', searchText)
  showSuggestions.value = false
  keyboardIndex.value = -1
}

function searchWithEngine(engine: Engine) {
  const searchText = query.value.trim()
  if (!searchText) return
  if (engine.url) window.open(engine.url.replace('%s', encodeURIComponent(searchText)), '_blank')
  saveToHistory(searchText)
  showSuggestions.value = false
  keyboardIndex.value = -1
}

function applySuggestion(s: SuggestionItem) {
  if (s.type === 'prompt') {
    // Navigate to prompt detail or open prompt page
    const promptId = s.rawData?.prompt_id || s.rawData?.id
    if (promptId) {
      window.location.href = `/prompts`
    }
    query.value = s.text
  } else if (s.type === 'search') {
    query.value = s.text
    // Execute the search
    const engine = props.currentEngine
    if (engine?.url) {
      window.open(engine.url.replace('%s', encodeURIComponent(s.text)), '_blank')
    }
    saveToHistory(s.text)
  } else if (s.url) {
    window.open(s.url, '_blank')
    query.value = s.text
    saveToHistory(s.text, s.url)
  } else {
    query.value = s.text
  }
  showSuggestions.value = false
  keyboardIndex.value = -1
}

let inputDebounceTimer: ReturnType<typeof setTimeout> | null = null

function onFocus() {
  showSuggestions.value = true
  keyboardIndex.value = -1
  loadHistory()
  // Load default prompt suggestions when focusing with empty query
  if (!query.value.trim()) {
    loadPromptSuggestions()
    loadBrowserHistory() // Recent browser history from extension
  }
}

function onInput() {
  keyboardIndex.value = -1
  const q = query.value.trim()
  if (q) {
    // Debounce prompt + browser history search
    if (inputDebounceTimer) clearTimeout(inputDebounceTimer)
    inputDebounceTimer = setTimeout(() => {
      loadPromptSuggestions(q)
      loadBrowserHistory(q)
    }, 300)
  } else {
    loadPromptSuggestions()
    loadBrowserHistory()
  }
  emit('search', query.value)
}

function hideSuggestionsDelayed() {
  setTimeout(() => {
    showSuggestions.value = false
    keyboardIndex.value = -1
  }, 200)
}

// ── Keyboard navigation ─────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  const items = filteredSuggestions.value
  if (!showSuggestions.value || items.length === 0) {
    if (e.key === 'Enter') {
      handleSearch(e)
    }
    return
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      keyboardIndex.value = keyboardIndex.value < items.length - 1 ? keyboardIndex.value + 1 : 0
      break
    case 'ArrowUp':
      e.preventDefault()
      keyboardIndex.value = keyboardIndex.value > 0 ? keyboardIndex.value - 1 : items.length - 1
      break
    case 'Enter':
      if (keyboardIndex.value >= 0 && keyboardIndex.value < items.length) {
        e.preventDefault()
        applySuggestion(items[keyboardIndex.value])
      } else {
        handleSearch(e)
      }
      break
    case 'Escape':
      showSuggestions.value = false
      keyboardIndex.value = -1
      break
  }
}

function toggleEngine(engine: Engine) {
  if (enabledEngineIds.value.has(engine.id)) enabledEngineIds.value.delete(engine.id)
  else enabledEngineIds.value.add(engine.id)
  enabledEngineIds.value = new Set(enabledEngineIds.value)
  $fetch(`/api/admin/search-engines/${engine.id}`, {
    method: 'PUT',
    body: { is_default: enabledEngineIds.value.has(engine.id) ? 1 : 0 }
  }).then(() => {
    // Sync back to Pinia store so the search bar icon/tabs update
    searchEngineStore.fetchEngines()
  }).catch(() => {})
}

// ── Textarea auto-resize ────────────────────────────────────────
watch(query, () => {
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.style.height = 'auto'
      inputRef.value.style.height = inputRef.value.scrollHeight + 'px'
    }
  })
})

// ── Init ────────────────────────────────────────────────────────
onMounted(() => {
  loadHistory()
})
</script>

<style scoped>
/* 覆盖 main-bundle.css 中 .search-container 的 flex:1 和 margin 使搜索框居中 */
.search-container {
  flex: unset !important;
  margin: 1rem auto 2.5rem auto !important;
}

.dropdown-indicator { font-size: 10px; color: #999; margin-left: 2px; }

.suggestion-url {
  font-size: 11px;
  color: #94a3b8;
  margin-left: auto;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggestion-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suggestion-dash {
  color: #cbd5e1;
  margin: 0 4px;
  flex-shrink: 0;
}
.suggestion-type {
  font-size: 10px;
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
  margin-left: 4px;
}

/* Category tabs */
.category-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid #f0f0f0;
}
.category-tab {
  font-size: 12px;
  color: #666;
  padding: 3px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}
.category-tab:hover {
  background: #f0f0f0;
}
.category-tab.active {
  background: #667eea;
  color: #fff;
}

/* Keyboard selected highlight */
:deep(.search-suggestions li.keyboard-selected) {
  background: #f0f4ff;
}
[data-theme="dark"] :deep(.search-suggestions li.keyboard-selected) {
  background: rgba(102, 126, 234, 0.15);
}
</style>

<!-- Teleport 目标在 body 上，scoped 样式无法命中，需单独声明 -->
<style>
/* ===== 搜索引擎管理弹窗 (Teleport to body) ===== */
.engine-dialog-overlay {
  display: flex;
  position: fixed;
  z-index: 1002;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.4);
  justify-content: center;
  align-items: center;
}
.engine-dialog-content {
  position: relative;
  background: #fff;
  border-radius: 12px;
  padding: 2rem;
  width: 90%;
  max-width: 800px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.engine-dialog-close {
  position: absolute;
  top: 1rem;
  right: 1.5rem;
  font-size: 24px;
  cursor: pointer;
  color: #999;
  z-index: 1;
  line-height: 1;
}
.engine-dialog-close:hover { color: #333; }
.engine-dialog-title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 24px;
  color: #1a202c;
}
.engine-dialog-body { padding-right: 4px; }
.engine-dialog-category { margin-bottom: 24px; }
.engine-dialog-category-title {
  font-size: 14px;
  font-weight: 600;
  color: #888;
  margin-bottom: 12px;
  text-transform: uppercase;
}
/* 匹配旧版 .search-engine-options-container 6列网格 */
.engine-dialog-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
}
.engine-dialog-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  text-align: center;
  position: relative;
}
.engine-dialog-item:hover { background: #f5f5f5; }
.engine-dialog-item.selected { background: #e8f0fe; }
.engine-dialog-item input[type="checkbox"] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.engine-dialog-item-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.engine-dialog-item-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
}
.engine-dialog-item-name {
  font-size: 12px;
  color: #1a202c;
  line-height: 1.3;
  word-break: break-all;
}
/* 移动端 <=480px 改为3列 */
@media (max-width: 480px) {
  .engine-dialog-grid { grid-template-columns: repeat(3, 1fr); }
  .engine-dialog-content { padding: 1.25rem; width: 95%; }
}
/* 暗色模式 */
[data-theme="dark"] .engine-dialog-content {
  background: rgba(30, 41, 59, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
[data-theme="dark"] .engine-dialog-title { color: #e2e8f0; }
[data-theme="dark"] .engine-dialog-category-title { color: #94a3b8; }
[data-theme="dark"] .engine-dialog-item:hover { background: rgba(255, 255, 255, 0.08); }
[data-theme="dark"] .engine-dialog-item.selected { background: rgba(100, 126, 234, 0.2); }
[data-theme="dark"] .engine-dialog-item-name { color: #e2e8f0; }
[data-theme="dark"] .engine-dialog-close { color: #94a3b8; }
[data-theme="dark"] .engine-dialog-close:hover { color: #e2e8f0; }
</style>
