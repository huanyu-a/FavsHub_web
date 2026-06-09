<template>
  <div class="search-container">
    <form
      class="search-form"
      id="search-form"
      :class="{ 'focused-with-suggestions': showSuggestions && suggestions.length > 0 }"
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
          @keydown.enter.prevent="handleSearch($event)"
          @input="onInput"
          @focus="showSuggestions = true"
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
      <div class="search-suggestions-wrapper" :style="{ display: showSuggestions && suggestions.length > 0 ? 'block' : 'none' }">
        <div class="line-container" id="line-container">
          <hr class="custom-hr">
        </div>
        <div class="category-tabs" id="category-tabs"></div>
        <ul id="search-suggestions" class="search-suggestions">
          <li
            v-for="(s, i) in suggestions"
            :key="i"
            @mousedown.prevent="applySuggestion(s)"
          >
            <span class="suggestion-icon">
              <img v-if="s.icon" :src="s.icon" alt="" class="favicon" @error="(e) => ((e.target as HTMLElement).style.display = 'none')">
              <template v-else>📌</template>
            </span>
            <span class="suggestion-text">{{ s.title }}</span>
            <span class="suggestion-url">{{ s.url }}</span>
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
            {{ engine.name }}
          </span>
        </div>
      </div>
    </form>

    <!-- 搜索引擎管理弹窗（复用旧版 #search-engines-dialog 结构） -->
    <div id="search-engines-dialog" class="modal" :style="{ display: showEngineDialog ? 'flex' : 'none' }" @click.self="showEngineDialog = false">
      <div class="modal-content">
        <span class="close-button settings-modal-close" @click="showEngineDialog = false">&times;</span>
        <h2 class="search-engines-title">搜索引擎设置</h2>
        <div class="search-engines-container">
          <div v-for="cat in engineCategories" :key="cat.key" class="search-engine-category">
            <h3 class="category-title">{{ cat.label }}</h3>
            <div class="search-engine-grid">
              <label
                v-for="engine in cat.engines"
                :key="engine.id"
                class="search-engine-item"
                :class="{ selected: enabledEngineIds.has(engine.id) }"
              >
                <input
                  type="checkbox"
                  :checked="enabledEngineIds.has(engine.id)"
                  @change="toggleEngine(engine)"
                >
                <img :src="engine.icon || '/images/placeholder-icon.svg'" :alt="engine.name" class="search-engine-icon">
                <span class="search-engine-name">{{ engine.name }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SearchEngineDropdown from './SearchEngineDropdown.vue'

interface Engine {
  id: number
  name: string
  url: string
  icon?: string | null
  category?: string
}

interface Bookmark {
  id: number
  title: string
  url: string
  icon?: string
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

const inputRef = ref<HTMLTextAreaElement | null>(null)
const query = ref('')
const showDropdown = ref(false)
const showSuggestions = ref(false)
const showEngineDialog = ref(false)
const enabledEngineIds = ref(new Set<number>())

const engineCategories = computed(() => {
  const cats: Record<string, { key: string; label: string; engines: Engine[] }> = {
    SEARCH: { key: 'SEARCH', label: '通用搜索', engines: [] },
    AI: { key: 'AI', label: 'AI 搜索', engines: [] },
    SOCIAL: { key: 'SOCIAL', label: '社交媒体', engines: [] },
  }
  for (const e of props.engines) {
    const cat = e.category || 'SEARCH'
    if (cats[cat]) cats[cat].engines.push(e)
  }
  return Object.values(cats).filter(c => c.engines.length > 0)
})

watch(() => props.engines, (engines) => {
  for (const e of engines) enabledEngineIds.value.add(e.id)
}, { immediate: true })

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

function openEngineDialog() {
  showDropdown.value = false
  showEngineDialog.value = true
}

function handleSearch(e?: Event) {
  if (!query.value.trim()) return
  const engine = props.currentEngine
  const kbEvent = e instanceof KeyboardEvent ? e : undefined
  if (kbEvent?.metaKey || kbEvent?.ctrlKey) {
    props.engines.forEach(eng => {
      if (eng.url) window.open(eng.url.replace('%s', encodeURIComponent(query.value)), '_blank')
    })
  } else if (engine?.url) {
    window.open(engine.url.replace('%s', encodeURIComponent(query.value)), '_blank')
  }
  emit('search', query.value)
  showSuggestions.value = false
}

function searchWithEngine(engine: Engine) {
  if (!query.value.trim()) return
  if (engine.url) window.open(engine.url.replace('%s', encodeURIComponent(query.value)), '_blank')
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

function toggleEngine(engine: Engine) {
  if (enabledEngineIds.value.has(engine.id)) enabledEngineIds.value.delete(engine.id)
  else enabledEngineIds.value.add(engine.id)
  enabledEngineIds.value = new Set(enabledEngineIds.value)
}

watch(query, () => {
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.style.height = 'auto'
      inputRef.value.style.height = inputRef.value.scrollHeight + 'px'
    }
  })
})
</script>

<style scoped>
/* .search-container / .search-form / .search-input / .search-suggestions-wrapper /
   .search-suggestions / .tabs / .tab / #search-engines-dialog / .modal 等
   全部来自 main-bundle.css（含暗色模式与响应式）。
   仅补充搜索引擎管理弹窗内列表项的复选样式。 */
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

.search-engines-container { padding: 4px 0; }
.search-engine-category { margin-bottom: 16px; }
.category-title {
  font-size: 13px; font-weight: 600; color: #888; margin-bottom: 8px; text-transform: uppercase;
}
.search-engine-grid { display: flex; flex-direction: column; gap: 4px; }
.search-engine-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  border-radius: 8px; cursor: pointer; transition: background 0.15s;
}
.search-engine-item:hover { background: #f5f5f5; }
.search-engine-item.selected { background: #e8f0fe; }
.search-engine-item .search-engine-icon { width: 20px; height: 20px; object-fit: contain; }
.search-engine-name { font-size: 13px; }
</style>
