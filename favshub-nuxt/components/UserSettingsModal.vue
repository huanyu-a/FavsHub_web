<template>
  <Teleport to="body">
    <div v-if="visible" class="settings-overlay" @click.self="$emit('close')">
      <div class="settings-modal">
        <div class="settings-header">
          <h2><i class="ri-settings-3-line"></i> 个人设置</h2>
          <button class="settings-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="settings-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="settings-tab"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            <i :class="tab.icon"></i> {{ tab.label }}
          </button>
        </div>
        <div class="settings-body">
          <!-- ST5: 界面元素 -->
          <div v-if="activeTab === 'ui'" class="settings-section">
            <div class="setting-item">
              <span>显示搜索框</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showSearchBox', true)" @change="settingsStore.set('showSearchBox', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span>显示欢迎消息</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showWelcomeMessage', true)" @change="settingsStore.set('showWelcomeMessage', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span>显示页脚</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showFooter', true)" @change="settingsStore.set('showFooter', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span>新标签页打开链接</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('openInNewTab', true)" @change="settingsStore.set('openInNewTab', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
          </div>

          <!-- ST3: 快捷链接 -->
          <div v-if="activeTab === 'links'" class="settings-section">
            <div class="setting-item">
              <span><i class="ri-history-line"></i> 历史记录</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showHistoryLink', true)" @change="settingsStore.set('showHistoryLink', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span><i class="ri-download-line"></i> 下载记录</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showDownloadsLink', true)" @change="settingsStore.set('showDownloadsLink', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span><i class="ri-key-2-line"></i> 密码管理</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showPasswordsLink', true)" @change="settingsStore.set('showPasswordsLink', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span><i class="ri-apps-line"></i> 扩展管理</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showExtensionsLink', true)" @change="settingsStore.set('showExtensionsLink', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
          </div>

          <!-- ST4: 搜索设置 -->
          <div v-if="activeTab === 'search'" class="settings-section">
            <div class="setting-item">
              <span>显示搜索建议</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showSearchSuggestions', true)" @change="settingsStore.set('showSearchSuggestions', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span>历史记录建议</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showHistorySuggestions', true)" @change="settingsStore.set('showHistorySuggestions', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span>书签建议</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showBookmarkSuggestions', true)" @change="settingsStore.set('showBookmarkSuggestions', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span>提示词建议</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('showPromptSuggestions', true)" @change="settingsStore.set('showPromptSuggestions', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-item">
              <span>新标签页打开搜索结果</span>
              <label class="toggle"><input type="checkbox" :checked="settingsStore.get('openSearchInNewTab', true)" @change="settingsStore.set('openSearchInNewTab', ($event.target as HTMLInputElement).checked)"><span class="toggle-slider"></span></label>
            </div>
          </div>

          <!-- ST6: 书签布局 -->
          <div v-if="activeTab === 'layout'" class="settings-section">
            <div class="setting-item range-item">
              <label>卡片宽度</label>
              <input type="range" min="100" max="300" step="10" :value="settingsStore.get('bookmarkWidth', 200)" @input="settingsStore.set('bookmarkWidth', Number(($event.target as HTMLInputElement).value))">
              <span class="range-val">{{ settingsStore.get('bookmarkWidth', 200) }}px <em class="estimate">≈{{ cardsPerRow }}个/行</em></span>
            </div>
            <div class="setting-item range-item">
              <label>卡片高度</label>
              <input type="range" min="36" max="80" step="2" :value="settingsStore.get('bookmarkCardHeight', 50)" @input="settingsStore.set('bookmarkCardHeight', Number(($event.target as HTMLInputElement).value))">
              <span class="range-val">{{ settingsStore.get('bookmarkCardHeight', 50) }}px</span>
            </div>
            <div class="setting-item range-item">
              <label>容器宽度</label>
              <input type="range" min="50" max="100" step="5" :value="settingsStore.get('bookmarkContainerWidth', 85)" @input="settingsStore.set('bookmarkContainerWidth', Number(($event.target as HTMLInputElement).value))">
              <span class="range-val">{{ settingsStore.get('bookmarkContainerWidth', 85) }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const settingsStore = useSettingsStore()

const tabs = [
  { key: 'ui', label: '界面', icon: 'ri-layout-line' },
  { key: 'links', label: '快捷链接', icon: 'ri-links-line' },
  { key: 'search', label: '搜索', icon: 'ri-search-line' },
  { key: 'layout', label: '布局', icon: 'ri-layout-grid-line' },
]
const activeTab = ref('ui')

// 每行卡片数量预估（基于 1440px 视口宽度）
const cardsPerRow = computed(() => {
  const viewportWidth = 1440
  const containerPx = viewportWidth * (settingsStore.get('bookmarkContainerWidth', 85) as number) / 100
  const cardWidth = settingsStore.get('bookmarkWidth', 200) as number
  const gap = 16
  return Math.max(1, Math.floor((containerPx + gap) / (cardWidth + gap)))
})
</script>

