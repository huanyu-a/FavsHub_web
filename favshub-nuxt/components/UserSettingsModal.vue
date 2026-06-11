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

<style scoped>
.settings-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.4); display: flex;
  align-items: center; justify-content: center;
}
.settings-modal {
  background: #fff; border-radius: 14px; width: 90%; max-width: 560px;
  max-height: 80vh; overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
}
.settings-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px; border-bottom: 1px solid #f0f0f0;
}
.settings-header h2 { font-size: 18px; margin: 0; display: flex; align-items: center; gap: 6px; }
.settings-header h2 i { color: #667eea; }
.settings-close { background: none; border: none; font-size: 22px; cursor: pointer; color: #888; }
.settings-tabs {
  display: flex; gap: 0; border-bottom: 1px solid #f0f0f0; padding: 0 24px;
}
.settings-tab {
  padding: 10px 14px; font-size: 13px; border: none; background: none;
  cursor: pointer; color: #888; border-bottom: 2px solid transparent;
  display: flex; align-items: center; gap: 4px; transition: all 0.2s;
}
.settings-tab:hover { color: #333; }
.settings-tab.active { color: #667eea; border-bottom-color: #667eea; font-weight: 600; }
.settings-body { padding: 16px 24px; overflow-y: auto; flex: 1; }
.settings-section { display: flex; flex-direction: column; gap: 8px; }
.setting-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 14px; background: #f8f9fa; border-radius: 10px;
  transition: background 0.2s;
}
.setting-item:hover { background: #f0f2f5; }
.setting-item span { font-size: 14px; color: #555; display: flex; align-items: center; gap: 6px; }
.setting-item span i { font-size: 16px; color: #667eea; }

/* Toggle switch */
.toggle { position: relative; display: inline-block; width: 42px; height: 24px; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; inset: 0; background: #ccc; border-radius: 24px;
  cursor: pointer; transition: 0.3s;
}
.toggle-slider::before {
  content: ''; position: absolute; height: 18px; width: 18px;
  left: 3px; bottom: 3px; background: #fff; border-radius: 50%;
  transition: 0.3s;
}
.toggle input:checked + .toggle-slider { background: #10b981; }
.toggle input:checked + .toggle-slider::before { transform: translateX(18px); }

/* Range items */
.range-item { flex-direction: column; align-items: flex-start; gap: 8px; }
.range-item label { font-size: 14px; color: #555; font-weight: 500; }
.range-item input[type=range] { width: 100%; cursor: pointer; }
.range-val { font-size: 12px; color: #94a3b8; align-self: flex-end; display: flex; align-items: center; gap: 4px; }
.estimate { font-style: normal; color: #10b981; font-size: 12px; }

@media (max-width: 640px) {
  .settings-modal { width: 95%; max-height: 85vh; }
  .settings-tabs { padding: 0 12px; }
  .settings-tab { padding: 8px 10px; font-size: 12px; }
  .settings-body { padding: 12px 16px; }
}
</style>
