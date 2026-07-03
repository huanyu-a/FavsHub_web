<template>
  <div class="search-container">
    <form
      ref="searchFormEl"
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

      <!-- 搜索建议区域 -->
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
                <i class="ri-bookmark-line" style="font-size:14px;color:var(--text-tertiary);"></i>
              </template>
            </span>
            <span class="suggestion-text">{{ s.text }}</span>
            <span class="suggestion-dash" v-if="!mobile && s.url && s.type !== 'search'">-</span>
            <span v-if="!mobile" class="suggestion-url">{{ s.url ? formatUrl(s.url) : '' }}</span>
            <span class="suggestion-type">{{ typeLabel(s.type) }}</span>
          </li>
        </ul>
        <div id="tabs-container" class="tabs" v-if="engines.length > 0">
          <span class="search-tips">本次使用</span>
          <span
            v-for="engine in engines"
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

    <!-- 搜索引擎管理弹窗 -->
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
  mobile?: boolean
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

// Browser visit history from extension
const browserHistory = ref<SuggestionItem[]>([])


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
    window.postMessage({ type: 'favshub-ext-request', action, requestId, ...extraParams }, window.location.origin)
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
        icon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
        relevance: Math.exp(-((now - (item.lastVisitTime || now)) / (1000 * 60 * 60 * 24)) / 7), // 7-day half-life
      })
    }

    browserHistory.value = Array.from(uniqueItems.values())
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .slice(0, query ? 20 : 10)
  } catch { /* silent */ }
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

  // History (browser visit history only, no input history)
  const history: SuggestionItem[] = showHistory
    ? (q
        ? browserHistory.value.filter(h => multiWordMatch(h.text, words)).map(h => ({ ...h, relevance: 3 }))
        : browserHistory.value)
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
    ...history.slice(0, 5),
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
  if (activeTab.value === 'history') items = history
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

/** Open URL; on mobile use location.href to avoid popup blockers */
function openUrl(url: string) {
  if (props.mobile) {
    window.location.href = url
  } else {
    window.open(url, '_blank')
  }
}

function handleSearch(e?: Event) {
  const kbEvent = e instanceof KeyboardEvent ? e : undefined
  const searchText = query.value.trim()
  if (!searchText) return

  const engine = props.currentEngine
  if (kbEvent?.metaKey || kbEvent?.ctrlKey) {
    (props.allEngines || props.engines).forEach(eng => {
      if (eng.url) openUrl(eng.url.replace('%s', encodeURIComponent(searchText)))
    })
  } else if (engine?.url) {
    openUrl(engine.url.replace('%s', encodeURIComponent(searchText)))
  }
  emit('search', searchText)
  showSuggestions.value = false
  keyboardIndex.value = -1
}

function searchWithEngine(engine: Engine) {
  const searchText = query.value.trim()
  if (!searchText) return
  if (engine.url) openUrl(engine.url.replace('%s', encodeURIComponent(searchText)))
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
      openUrl(engine.url.replace('%s', encodeURIComponent(s.text)))
    }
  } else if (s.url) {
    openUrl(s.url)
    query.value = s.text
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
})
</script>

