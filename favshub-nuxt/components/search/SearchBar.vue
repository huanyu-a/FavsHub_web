<template>
  <div class="search-container">
    <form class="search-form" @submit.prevent="handleSearch">
      <div class="search-input-wrapper">
        <div class="search-icon-container" @click="toggleDropdown" title="切换搜索引擎">
          <img
            v-if="currentEngine?.icon"
            :src="currentEngine.icon"
            :alt="currentEngine.name"
            class="search-engine-icon"
          >
          <i v-else class="ri-search-line" style="font-size:16px;color:#999;"></i>
          <span class="dropdown-indicator">▾</span>
        </div>
        <input
          ref="inputRef"
          v-model="query"
          class="search-input"
          placeholder="按 Enter 键搜索，或按 Cmd/Ctrl + Enter 搜索所有引擎"
          @keydown.enter.prevent="handleSearch"
          @input="onInput"
          @focus="showSuggestions = true"
          @blur="hideSuggestionsDelayed"
        >
      </div>
      <SearchEngineDropdown
        :engines="engines"
        :visible="showDropdown"
        @select="selectEngine"
      />
      <SearchSuggestions
        :suggestions="suggestions"
        :visible="showSuggestions"
        @select="applySuggestion"
      />
    </form>
  </div>
</template>

<script setup lang="ts">
import SearchEngineDropdown from './SearchEngineDropdown.vue'
import SearchSuggestions from './SearchSuggestions.vue'

interface Engine {
  id: number
  name: string
  url: string
  icon?: string | null
}

interface Bookmark {
  id: number
  title: string
  url: string
}

const props = defineProps<{
  engines: Engine[]
  currentEngine: Engine | null
  bookmarks: Bookmark[]
}>()

const emit = defineEmits<{
  search: [query: string]
  'select-engine': [id: number]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const showDropdown = ref(false)
const showSuggestions = ref(false)

const suggestions = computed(() => {
  if (!query.value || query.value.length < 1) return []
  const q = query.value.toLowerCase()
  return props.bookmarks
    .filter(b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    .slice(0, 8)
})

function toggleDropdown() {
  showDropdown.value = !showDropdown.value
}

function selectEngine(engine: Engine) {
  emit('select-engine', engine.id)
  showDropdown.value = false
}

function handleSearch(e?: Event) {
  if (!query.value.trim()) return
  const engine = props.currentEngine
  if (engine?.url) {
    const searchUrl = engine.url.replace('%s', encodeURIComponent(query.value))
    const kbEvent = e instanceof KeyboardEvent ? e : undefined
    if (kbEvent?.metaKey || kbEvent?.ctrlKey) {
      props.engines.forEach(eng => {
        if (eng.url) window.open(eng.url.replace('%s', encodeURIComponent(query.value)), '_blank')
      })
    } else {
      window.open(searchUrl, '_blank')
    }
  }
  emit('search', query.value)
  showSuggestions.value = false
}

function onInput() {
  emit('search', query.value)
}

function applySuggestion(s: Bookmark) {
  window.open(s.url, '_blank')
  query.value = s.title
  showSuggestions.value = false
}

function hideSuggestionsDelayed() {
  setTimeout(() => { showSuggestions.value = false }, 200)
}
</script>

<style scoped>
.search-container {
  width: 100%;
  max-width: 600px;
  position: relative;
}
.search-form { position: relative; }
.search-input-wrapper {
  display: flex;
  align-items: center;
  border: 1.5px solid #e0e0e0;
  border-radius: 10px;
  background: #fff;
  transition: border-color 0.2s;
}
.search-input-wrapper:focus-within { border-color: #667eea; }
.search-icon-container {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 12px;
  cursor: pointer;
}
.search-engine-icon { width: 20px; height: 20px; object-fit: contain; }
.dropdown-indicator { font-size: 10px; color: #999; }
.search-input {
  flex: 1;
  padding: 12px 12px 12px 0;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
  color: #333;
}
/* Dark mode is now defined globally in layouts/default.vue */
</style>
