<template>
  <div class="search-container">
    <form class="search-form" :class="{ 'focused-with-suggestions': showSuggestions && suggestions.length > 0 }" @submit.prevent="handleSearch">
      <div class="search-row-inner">
        <div class="search-icon-container" @click="toggleDropdown" title="切换搜索引擎">
          <img
            v-if="currentEngine?.icon"
            :src="currentEngine.icon"
            :alt="currentEngine.name"
            class="search-engine-icon"
          >
          <img v-else src="/images/placeholder-icon.svg" alt="Search" class="search-engine-icon">
          <span class="dropdown-indicator">▼</span>
        </div>
        <textarea
          ref="inputRef"
          v-model="query"
          class="search-input"
          placeholder="按 Enter 键搜索，或按 Cmd/Ctrl + Enter 搜索所有引擎"
          rows="1"
          @keydown.enter.prevent="handleSearch"
          @input="onInput"
          @focus="showSuggestions = true"
          @blur="hideSuggestionsDelayed"
        ></textarea>
      </div>

      <!-- 搜索建议区域 -->
      <div v-if="showSuggestions && suggestions.length > 0" class="search-suggestions-wrapper">
        <div class="line-container">
          <hr class="custom-hr">
        </div>
        <ul class="search-suggestions">
          <li
            v-for="(s, i) in suggestions"
            :key="i"
            class="search-suggestion-item"
            @mousedown.prevent="applySuggestion(s)"
          >
            <img
              v-if="s.icon"
              :src="s.icon"
              class="suggestion-icon"
              @error="(e) => (e.target as HTMLElement).style.display='none'"
            >
            <span class="suggestion-icon" v-else>📌</span>
            <span class="suggestion-text">{{ s.title }}</span>
            <span class="suggestion-url">{{ s.url }}</span>
          </li>
        </ul>
        <!-- 搜索引擎标签 -->
        <div class="tabs" v-if="engines.length > 0">
          <span class="search-tips">本次使用</span>
          <div
            v-for="engine in engines"
            :key="engine.id"
            class="tab"
            :class="{ active: currentEngine?.id === engine.id }"
            :data-engine="engine.name"
            @click="searchWithEngine(engine)"
          >
            {{ engine.name }}
          </div>
        </div>
      </div>

      <!-- 搜索引擎下拉 -->
      <SearchEngineDropdown
        :engines="engines"
        :visible="showDropdown"
        @select="selectEngine"
        @manage="showEngineDialog = true"
      />

      <!-- 搜索引擎管理弹窗 -->
      <div v-if="showEngineDialog" class="modal-overlay" @click.self="showEngineDialog = false">
        <div class="modal-content search-engines-dialog">
          <span class="close-button" @click="showEngineDialog = false">&times;</span>
          <h2 class="search-engines-title">搜索引擎设置</h2>
          <div class="search-engines-container">
            <div v-for="cat in engineCategories" :key="cat.key" class="search-engine-category">
              <h3 class="category-title">{{ cat.label }}</h3>
              <div class="search-engine-grid">
                <div
                  v-for="engine in cat.engines"
                  :key="engine.id"
                  class="search-engine-item"
                  :class="{ selected: enabledEngineIds.has(engine.id) }"
                  @click="toggleEngine(engine)"
                >
                  <label class="custom-checkbox" @click.stop>
                    <input
                      type="checkbox"
                      :checked="enabledEngineIds.has(engine.id)"
                      @change="toggleEngine(engine)"
                    >
                    <span class="checkmark"></span>
                  </label>
                  <div class="search-engine-info">
                    <img :src="engine.icon || '/images/placeholder-icon.svg'" :alt="engine.name" class="search-engine-icon">
                    <span class="search-engine-name">{{ engine.name }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
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

// 引擎分类
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

// 初始化已启用的搜索引擎
watch(() => props.engines, (engines) => {
  for (const e of engines) {
    enabledEngineIds.value.add(e.id)
  }
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

function searchWithEngine(engine: Engine) {
  if (!query.value.trim()) return
  if (engine.url) {
    window.open(engine.url.replace('%s', encodeURIComponent(query.value)), '_blank')
  }
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
  if (enabledEngineIds.value.has(engine.id)) {
    enabledEngineIds.value.delete(engine.id)
  } else {
    enabledEngineIds.value.add(engine.id)
  }
  // 触发响应式更新
  enabledEngineIds.value = new Set(enabledEngineIds.value)
}

// 自动调整 textarea 高度
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
.search-container {
  width: 100%;
  max-width: 600px;
  position: relative;
}
.search-form {
  position: relative;
  background: #fff;
  border: 1.5px solid #e0e0e0;
  border-radius: 10px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.search-form:focus-within,
.search-form.focused-with-suggestions {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.1);
}

.search-row-inner {
  display: flex;
  align-items: flex-start;
}

.search-icon-container {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 12px 0 12px 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.search-engine-icon { width: 20px; height: 20px; object-fit: contain; }
.dropdown-indicator { font-size: 10px; color: #999; margin-left: 2px; }

.search-input {
  flex: 1;
  padding: 12px 12px 12px 8px;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
  color: #333;
  resize: none;
  min-height: 20px;
  line-height: 1.5;
  font-family: inherit;
}
.search-input::placeholder { color: #999; }

/* 搜索建议 */
.search-suggestions-wrapper {
  border-top: 1px solid #f0f0f0;
  padding: 8px 0;
}
.line-container { padding: 0 16px; }
.custom-hr {
  border: none;
  border-top: 1px solid #f0f0f0;
  margin: 0;
}

.search-suggestions {
  list-style: none;
  padding: 0;
  margin: 0;
}
.search-suggestion-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.15s;
  font-size: 13px;
}
.search-suggestion-item:hover {
  background: #f5f5f5;
}
.suggestion-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.suggestion-text {
  color: #333;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggestion-url {
  font-size: 11px;
  color: #999;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 搜索引擎标签 */
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px 4px;
  flex-wrap: wrap;
}
.search-tips {
  font-size: 11px;
  color: #999;
  margin-right: 8px;
}
.tab {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: #666;
  background: #f5f5f5;
  cursor: pointer;
  transition: all 0.15s;
}
.tab:hover { background: #e8e8e8; }
.tab.active { background: #667eea; color: #fff; }

/* 搜索引擎管理弹窗 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.search-engines-dialog {
  background: #fff;
  border-radius: 12px;
  width: 90%;
  max-width: 520px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px;
  position: relative;
}
.close-button {
  position: absolute;
  right: 16px;
  top: 16px;
  font-size: 24px;
  cursor: pointer;
  color: #999;
  background: none;
  border: none;
}
.search-engines-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 20px;
}
.search-engine-category { margin-bottom: 16px; }
.category-title {
  font-size: 13px;
  font-weight: 600;
  color: #888;
  margin-bottom: 8px;
  text-transform: uppercase;
}
.search-engine-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.search-engine-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.search-engine-item:hover { background: #f5f5f5; }
.search-engine-item.selected { background: #e8f0fe; }

.custom-checkbox {
  display: flex;
  align-items: center;
  cursor: pointer;
}
.custom-checkbox input { display: none; }
.checkmark {
  width: 18px;
  height: 18px;
  border: 2px solid #ccc;
  border-radius: 4px;
  transition: all 0.15s;
}
.search-engine-item.selected .checkmark {
  background: #667eea;
  border-color: #667eea;
}

.search-engine-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search-engine-info .search-engine-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
}
.search-engine-name { font-size: 13px; }

@media (max-width: 640px) {
  .search-container { max-width: 100%; }
}
</style>
