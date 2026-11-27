<template>
  <Teleport to="body">
    <button
      v-if="isMobile && !isOpen"
      type="button"
      class="gs-mobile-launcher"
      aria-label="打开全站搜索"
      aria-keyshortcuts="Control+K Meta+K"
      title="全站搜索"
      @click="open"
    >
      <i class="ri-search-2-line" aria-hidden="true"></i>
    </button>
  </Teleport>

  <Teleport to="body">
    <Transition name="gs-fade">
      <div v-if="isOpen" class="gs-backdrop" @mousedown.self="close">
        <section
          class="gs-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="global-search-title"
          @keydown="trapFocus"
        >
          <h2 id="global-search-title" class="gs-sr-only">全站搜索</h2>

          <header class="gs-search-header">
            <i class="ri-search-2-line gs-leading-icon" aria-hidden="true"></i>
            <input
              ref="inputRef"
              v-model="query"
              type="search"
              class="gs-input"
              placeholder="搜索书签、精选集、提示词、Token 通告…"
              aria-label="全站搜索关键词"
              aria-autocomplete="list"
              aria-controls="global-search-listbox"
              :aria-expanded="hasResults"
              :aria-activedescendant="activeDescendantId"
              role="combobox"
              autocomplete="off"
              spellcheck="false"
              maxlength="80"
              @keydown="handleInputKeydown"
            >
            <i v-if="loading" class="ri-loader-4-line gs-spinner" aria-hidden="true"></i>
            <button type="button" class="gs-close" aria-label="关闭搜索" @click="close">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </header>

          <div class="gs-scope-bar">
            <span>当前权限范围内的全站内容</span>
            <span class="gs-scope-count">{{ normalizedQuery ? `${total} 条匹配` : '最近与快捷入口' }}</span>
          </div>

          <div class="gs-results">
            <div v-if="errorMessage" class="gs-state gs-error" role="alert">
              <i class="ri-error-warning-line" aria-hidden="true"></i>
              <p>{{ errorMessage }}</p>
            </div>

            <div v-else-if="loading && !hasResults" class="gs-state">
              <i class="ri-loader-4-line gs-spinner" aria-hidden="true"></i>
              <p>正在搜索全站内容…</p>
            </div>

            <div
              v-else-if="hasResults"
              id="global-search-listbox"
              class="gs-result-groups"
              role="listbox"
              aria-label="搜索结果"
            >
              <section
                v-for="meta in visibleGroups"
                :key="meta.key"
                class="gs-group"
                role="group"
                :aria-label="meta.label"
              >
                <h3 class="gs-group-title">
                  <span><i :class="meta.icon" aria-hidden="true"></i>{{ meta.label }}</span>
                  <span>{{ groups[meta.key].length }}</span>
                </h3>
                <button
                  v-for="(result, localIndex) in groups[meta.key]"
                  :id="`global-search-option-${resultIndex(meta.key, localIndex)}`"
                  :key="`${result.type}:${result.id}`"
                  type="button"
                  class="gs-result"
                  :class="{ active: activeIndex === resultIndex(meta.key, localIndex) }"
                  role="option"
                  :aria-selected="activeIndex === resultIndex(meta.key, localIndex)"
                  tabindex="-1"
                  @mouseenter="activeIndex = resultIndex(meta.key, localIndex)"
                  @click="selectResult(result)"
                >
                  <span class="gs-result-icon"><i :class="meta.icon" aria-hidden="true"></i></span>
                  <span class="gs-result-copy">
                    <span class="gs-result-title">{{ result.title }}</span>
                    <span v-if="result.subtitle" class="gs-result-subtitle">{{ result.subtitle }}</span>
                  </span>
                  <i
                    :class="result.external ? 'ri-external-link-line' : 'ri-arrow-right-line'"
                    class="gs-result-arrow"
                    aria-hidden="true"
                  ></i>
                </button>
              </section>
            </div>

            <template v-else-if="noResults">
              <div class="gs-state gs-empty">
                <i class="ri-search-eye-line" aria-hidden="true"></i>
                <p>没有找到与“{{ normalizedQuery }}”相关的内容</p>
                <span>试试更短的关键词，或从下面的页面入口继续浏览。</span>
              </div>
              <section class="gs-shortcuts">
                <h3 class="gs-section-title">分类与页面</h3>
                <div class="gs-quick-grid">
                  <button
                    v-for="link in quickLinks"
                    :key="link.url"
                    type="button"
                    class="gs-quick-link"
                    @click="openQuickLink(link)"
                  >
                    <i :class="link.icon" aria-hidden="true"></i>
                    <span><strong>{{ link.title }}</strong><small>{{ link.subtitle }}</small></span>
                    <i class="ri-arrow-right-line" aria-hidden="true"></i>
                  </button>
                </div>
              </section>
            </template>

            <template v-else-if="!normalizedQuery">
              <section v-if="recentSearches.length" class="gs-recent-section">
                <div class="gs-section-heading">
                  <h3 class="gs-section-title">最近搜索</h3>
                  <button type="button" class="gs-text-button" @click="clearRecentSearches">清除</button>
                </div>
                <div class="gs-search-chips">
                  <button
                    v-for="term in recentSearches"
                    :key="term"
                    type="button"
                    class="gs-search-chip"
                    @mousedown.prevent
                    @click="applyRecent(term)"
                  >
                    <i class="ri-history-line" aria-hidden="true"></i>{{ term }}
                  </button>
                </div>
              </section>

              <section v-if="recentVisits.length" class="gs-recent-section">
                <div class="gs-section-heading">
                  <h3 class="gs-section-title">最近访问</h3>
                  <button type="button" class="gs-text-button" @click="clearRecentVisits">清除</button>
                </div>
                <div class="gs-recent-visits">
                  <button
                    v-for="visit in recentVisits"
                    :key="`${visit.type}:${visit.id}`"
                    type="button"
                    class="gs-result gs-recent-visit"
                    @click="selectResult(visit)"
                  >
                    <span class="gs-result-icon"><i :class="typeIcon(visit.type)" aria-hidden="true"></i></span>
                    <span class="gs-result-copy">
                      <span class="gs-result-title">{{ visit.title }}</span>
                      <span v-if="visit.subtitle" class="gs-result-subtitle">{{ visit.subtitle }}</span>
                    </span>
                    <span class="gs-visit-type">{{ typeLabel(visit.type) }}</span>
                  </button>
                </div>
              </section>

              <section class="gs-shortcuts">
                <h3 class="gs-section-title">分类与页面</h3>
                <div class="gs-quick-grid">
                  <button
                    v-for="link in quickLinks"
                    :key="link.url"
                    type="button"
                    class="gs-quick-link"
                    @click="openQuickLink(link)"
                  >
                    <i :class="link.icon" aria-hidden="true"></i>
                    <span><strong>{{ link.title }}</strong><small>{{ link.subtitle }}</small></span>
                    <i class="ri-arrow-right-line" aria-hidden="true"></i>
                  </button>
                </div>
              </section>
            </template>
          </div>

          <!-- 网页搜索：当前引擎 + 切换 + 跳转（暂时禁用，排查 SSR 500） -->
          <div v-if="false" class="gs-web-search">
            <div class="gs-web-search-left">
              <img
                :src="currentEngine?.icon || '/images/placeholder-icon.svg'"
                :alt="currentEngine?.name || '搜索引擎'"
                class="gs-web-engine-icon"
              >
              <span class="gs-web-engine-name">{{ currentEngine?.name || '网页搜索' }}</span>
            </div>
            <div class="gs-web-search-right">
              <button
                type="button"
                class="gs-web-search-btn"
                :disabled="!normalizedQuery"
                @click="searchWeb"
              >
                <i class="ri-external-link-line" aria-hidden="true"></i>
                搜索网页
              </button>
              <button
                type="button"
                class="gs-web-engine-toggle"
                aria-label="切换搜索引擎"
                @click="showEngineDropdown = !showEngineDropdown"
              >
                <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
              </button>
            </div>
            <div v-if="showEngineDropdown" class="gs-engine-dropdown">
              <button
                v-for="engine in engines"
                :key="engine.id"
                type="button"
                class="gs-engine-option"
                :class="{ active: engine.id === currentEngine?.id }"
                @click="selectEngine(engine)"
              >
                <img :src="engine.icon || '/images/placeholder-icon.svg'" :alt="engine.name" class="gs-engine-option-icon">
                <span>{{ engine.name }}</span>
              </button>
            </div>
          </div>

          <footer class="gs-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 打开</span>
            <span><kbd>Esc</kbd> 关闭</span>
            <span class="gs-footer-shortcut"><kbd>Ctrl</kbd><span>/</span><kbd>⌘</kbd><span>+</span><kbd>K</kbd></span>
          </footer>

          <div class="gs-sr-only" aria-live="polite">
            {{ liveMessage }}
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { GlobalSearchGroup, GlobalSearchType } from '~/composables/useGlobalSearch'

const inputRef = ref<HTMLInputElement | null>(null)
const { isMobile } = useMobile()
const {
  isOpen,
  query,
  groups,
  loading,
  errorMessage,
  activeIndex,
  activeDescendantId,
  recentSearches,
  recentVisits,
  total,
  hasResults,
  noResults,
  quickLinks,
  open,
  close,
  applyRecentSearch,
  clearRecentSearches,
  clearRecentVisits,
  selectResult,
  openQuickLink,
  handleInputKeydown,
  handleGlobalKeydown,
} = useGlobalSearch()

// ── 网页搜索：引擎切换 + 跳转（模板 v-if="false" 禁用，排查 SSR 500）──
const searchEngineStore = useSearchEnginesStore()
const engines = computed(() => searchEngineStore.engines)
const currentEngine = computed(() => searchEngineStore.currentEngine)
const showEngineDropdown = ref(false)

function selectEngine(engine: any) {
  searchEngineStore.setCurrentEngine(engine.id)
  showEngineDropdown.value = false
}

function searchWeb() {
  if (!normalizedQuery.value || !currentEngine.value) return
  const url = currentEngine.value.url.replace('%s', encodeURIComponent(normalizedQuery.value))
  window.open(url, '_blank', 'noopener')
}

onMounted(() => {
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.gs-web-search')) {
      showEngineDropdown.value = false
    }
  })
})

const groupMeta: Array<{ key: GlobalSearchGroup; label: string; icon: string }> = [
  { key: 'bookmarks', label: '个人书签', icon: 'ri-bookmark-3-line' },
  { key: 'collections', label: '公开精选集', icon: 'ri-book-2-line' },
  { key: 'prompts', label: '提示词', icon: 'ri-chat-3-line' },
  { key: 'tokens', label: 'Token 通告', icon: ('ri-gift-' + '2-line') },
]

const normalizedQuery = computed(() => query.value.replace(/\s+/g, ' ').trim())
const visibleGroups = computed(() => groupMeta.filter(meta => groups.value[meta.key].length > 0))
const liveMessage = computed(() => {
  if (loading.value) return '正在搜索'
  if (errorMessage.value) return errorMessage.value
  if (noResults.value) return '没有找到匹配内容'
  if (normalizedQuery.value) return `找到 ${total.value} 条结果`
  return ''
})

const typeIcons: Record<GlobalSearchType, string> = {
  bookmark: 'ri-bookmark-3-line',
  collection: 'ri-book-2-line',
  prompt: 'ri-chat-3-line',
  token: ('ri-gift-' + '2-line'),
}

const typeLabels: Record<GlobalSearchType, string> = {
  bookmark: '书签',
  collection: '精选集',
  prompt: '提示词',
  token: '通告',
}

function typeIcon(type: GlobalSearchType): string {
  return typeIcons[type]
}

function typeLabel(type: GlobalSearchType): string {
  return typeLabels[type]
}

function resultIndex(group: GlobalSearchGroup, localIndex: number): number {
  const groupOffset = groupMeta.findIndex(meta => meta.key === group)
  let offset = 0
  for (let i = 0; i < groupOffset; i++) {
    offset += groups.value[groupMeta[i].key].length
  }
  return offset + localIndex
}

function applyRecent(term: string) {
  applyRecentSearch(term)
  nextTick(() => inputRef.value?.focus())
}

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const panel = event.currentTarget as HTMLElement
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
    'input:not([disabled]), button:not([disabled]):not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])',
  )).filter(element => element.offsetParent !== null)
  if (!focusable.length) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

let previouslyFocused: HTMLElement | null = null
let previousBodyOverflow = ''

watch(isOpen, async (openNow) => {
  if (!import.meta.client) return
  if (openNow) {
    previouslyFocused = document.activeElement as HTMLElement | null
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    await nextTick()
    if (isOpen.value) inputRef.value?.focus()
  } else {
    document.body.style.overflow = previousBodyOverflow
    const focusTarget = previouslyFocused
    previouslyFocused = null
    await nextTick()
    if (focusTarget?.isConnected) {
      focusTarget.focus()
    } else {
      document.querySelector<HTMLElement>('.gs-mobile-launcher')?.focus()
    }
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleGlobalKeydown, true)
  if (document.body.style.overflow === 'hidden') {
    document.body.style.overflow = previousBodyOverflow
  }
})
</script>

<style scoped>
.gs-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.gs-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10020;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  box-sizing: border-box;
  padding: min(12vh, 96px) 16px 24px;
  background: var(--overlay, rgba(0, 0, 0, 0.48));
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-family: var(--font-system, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}

.gs-panel {
  width: min(720px, calc(100vw - 32px));
  max-height: min(76vh, 760px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--surface-raised, var(--surface));
  border: 1px solid var(--border);
  border-radius: var(--radius-xl, 20px);
  box-shadow: var(--shadow-xl, 0 24px 80px rgba(0, 0, 0, 0.24));
  transform-origin: top center;
}

.gs-search-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.gs-leading-icon {
  flex-shrink: 0;
  font-size: 22px;
  color: var(--color-primary, var(--primary));
}

.gs-input {
  min-width: 0;
  flex: 1;
  box-sizing: border-box;
  padding: 4px 0;
  border: 0;
  outline: 0;
  color: var(--text-primary);
  background: transparent;
  font: inherit;
  font-size: 18px;
  line-height: 1.5;
  appearance: none;
}

.gs-input::-webkit-search-cancel-button { display: none; }
.gs-input::placeholder { color: var(--text-tertiary); }
.gs-search-header:focus-within { box-shadow: inset 0 -2px var(--color-primary, var(--primary)); }

.gs-close {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm, 8px);
  color: var(--text-secondary);
  background: var(--surface-sunken);
  cursor: pointer;
  font-size: 20px;
  transition: color 160ms ease, background 160ms ease;
}

.gs-close:hover { color: var(--text-primary); background: var(--surface-hover); }

.gs-scope-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  padding: 8px 20px;
  color: var(--text-tertiary);
  background: var(--surface-sunken);
  font-size: 12px;
}

.gs-scope-count { color: var(--text-secondary); }

.gs-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.gs-group + .gs-group { margin-top: 10px; }

.gs-group-title,
.gs-section-title {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.gs-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 6px;
}

.gs-group-title > span:first-child { display: inline-flex; align-items: center; gap: 7px; }
.gs-group-title i { color: var(--color-primary, var(--primary)); font-size: 14px; }

.gs-result {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  padding: 10px;
  border: 0;
  border-radius: var(--radius-md, 12px);
  color: var(--text-primary);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: background 140ms ease, box-shadow 140ms ease;
}

.gs-result:hover { background: var(--surface-hover); }
.gs-result.active {
  background: var(--surface-selected, var(--primary-light));
  box-shadow: inset 3px 0 var(--color-primary, var(--primary));
}

.gs-result-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--color-primary, var(--primary));
  background: var(--primary-light, var(--surface-sunken));
  font-size: 18px;
}

.gs-result-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.gs-result-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 550; }
.gs-result-subtitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-tertiary); font-size: 12px; }
.gs-result-arrow { flex-shrink: 0; color: var(--text-tertiary); font-size: 16px; }
.gs-result.active .gs-result-arrow { color: var(--color-primary, var(--primary)); }

.gs-state {
  min-height: 132px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--text-secondary);
  text-align: center;
}

.gs-state > i { color: var(--text-tertiary); font-size: 28px; }
.gs-state p { margin: 0; color: var(--text-primary); font-size: 14px; }
.gs-state span { max-width: 420px; color: var(--text-tertiary); font-size: 12px; line-height: 1.6; }
.gs-error > i { color: var(--danger); }

.gs-recent-section + .gs-recent-section,
.gs-recent-section + .gs-shortcuts,
.gs-shortcuts + .gs-recent-section { margin-top: 16px; }
.gs-shortcuts { padding: 4px 0 6px; }
.gs-empty + .gs-shortcuts { padding-top: 0; }
.gs-section-heading { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px 8px; }
.gs-shortcuts > .gs-section-title { display: block; padding: 4px 10px 8px; }

.gs-text-button {
  padding: 2px 4px;
  border: 0;
  color: var(--text-tertiary);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.gs-text-button:hover { color: var(--color-primary, var(--primary)); }

.gs-search-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 10px; }
.gs-search-chip {
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gs-search-chip:hover { color: var(--color-primary, var(--primary)); border-color: var(--border-focus); }

.gs-recent-visits { display: flex; flex-direction: column; gap: 2px; }
.gs-visit-type { flex-shrink: 0; color: var(--text-tertiary); font-size: 11px; }

.gs-quick-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 4px; }
.gs-quick-link {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 12px);
  color: var(--text-secondary);
  background: var(--surface-sunken);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: border-color 140ms ease, background 140ms ease;
}
.gs-quick-link:hover { border-color: var(--border-focus); background: var(--surface-hover); }
.gs-quick-link > i:first-child { flex-shrink: 0; color: var(--color-primary, var(--primary)); font-size: 19px; }
.gs-quick-link > i:last-child { flex-shrink: 0; color: var(--text-tertiary); }
.gs-quick-link > span { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.gs-quick-link strong { overflow: hidden; color: var(--text-primary); font-size: 13px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.gs-quick-link small { overflow: hidden; color: var(--text-tertiary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }

/* ── 网页搜索栏 ────────────────────────────────────────────── */
.gs-web-search {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface-sunken);
}
.gs-web-search-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.gs-web-engine-icon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  object-fit: contain;
}
.gs-web-engine-name {
  color: var(--text-secondary);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gs-web-search-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.gs-web-search-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--color-primary, var(--primary));
  background: var(--surface-raised);
  font-size: 12px;
  cursor: pointer;
  transition: background 140ms, border-color 140ms;
}
.gs-web-search-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--border-focus);
}
.gs-web-search-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.gs-web-engine-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-tertiary);
  background: var(--surface-raised);
  cursor: pointer;
}
.gs-web-engine-toggle:hover {
  background: var(--surface-hover);
}
.gs-engine-dropdown {
  position: absolute;
  bottom: 100%;
  right: 16px;
  z-index: 10;
  min-width: 180px;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.12));
}
.gs-engine-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  color: var(--text-primary);
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.gs-engine-option:hover { background: var(--surface-hover); }
.gs-engine-option.active { background: var(--surface-hover); font-weight: 600; }
.gs-engine-option-icon {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  object-fit: contain;
}

.gs-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
  padding: 10px 18px;
  border-top: 1px solid var(--border);
  color: var(--text-tertiary);
  background: var(--surface-sunken);
  font-size: 11px;
}
.gs-footer > span { display: inline-flex; align-items: center; gap: 4px; }
.gs-footer-shortcut { margin-left: auto; }
.gs-footer kbd {
  min-width: 20px;
  box-sizing: border-box;
  padding: 2px 5px;
  border: 1px solid var(--border);
  border-bottom-color: var(--border-focus);
  border-radius: 5px;
  color: var(--text-secondary);
  background: var(--surface-raised);
  font: inherit;
  text-align: center;
}

.gs-spinner { animation: gs-spin 800ms linear infinite; }

.gs-mobile-launcher {
  display: none;
  position: fixed;
  right: 33px;
  /* 公告 FAB 在 176px，搜索按钮放它上方（176 + 48 + 12 = 236px） */
  bottom: calc(236px + env(safe-area-inset-bottom, 0px));
  z-index: 10004;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  color: var(--text-inverse);
  background: var(--color-primary, var(--primary));
  box-shadow: var(--shadow-md);
  cursor: pointer;
  font-size: 20px;
}

.gs-close:focus-visible,
.gs-result:focus-visible,
.gs-text-button:focus-visible,
.gs-search-chip:focus-visible,
.gs-quick-link:focus-visible,
.gs-mobile-launcher:focus-visible {
  outline: 2px solid var(--color-primary, var(--primary));
  outline-offset: 2px;
}

.gs-fade-enter-active,
.gs-fade-leave-active { transition: opacity 180ms ease; }
.gs-fade-enter-active .gs-panel,
.gs-fade-leave-active .gs-panel { transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1); }
.gs-fade-enter-from,
.gs-fade-leave-to { opacity: 0; }
.gs-fade-enter-from .gs-panel,
.gs-fade-leave-to .gs-panel { transform: translateY(-10px) scale(0.985); }

@keyframes gs-spin { to { transform: rotate(360deg); } }

@media (max-width: 1024px) {
  .gs-mobile-launcher { display: inline-flex; }
}

@media (max-width: 768px) {
  .gs-mobile-launcher { right: 35px; }
}

@media (max-width: 640px) {
  .gs-backdrop { padding: 60px 8px calc(84px + env(safe-area-inset-bottom, 0px)); }
  .gs-panel { width: 100%; max-height: 100%; border-radius: 16px; }
  .gs-search-header { gap: 9px; padding: 13px 12px; }
  .gs-leading-icon { font-size: 20px; }
  .gs-input { font-size: 16px; }
  .gs-scope-bar { padding: 7px 14px; }
  .gs-results { padding: 8px; }
  .gs-result { gap: 10px; padding: 9px; }
  .gs-result-icon { width: 34px; height: 34px; }
  .gs-result-title { font-size: 13px; }
  .gs-quick-grid { grid-template-columns: 1fr; }
  .gs-footer { gap: 10px; padding: 9px 12px; }
  .gs-footer-shortcut { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .gs-spinner { animation: none; }
  .gs-fade-enter-active,
  .gs-fade-leave-active,
  .gs-fade-enter-active .gs-panel,
  .gs-fade-leave-active .gs-panel,
  .gs-result,
  .gs-quick-link,
  .gs-close { transition: none; }
}
</style>
