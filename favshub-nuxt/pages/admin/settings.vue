<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>全局默认设置</h1>
      <p>所有用户生效（个人设置优先于全局默认）</p>
    </header>
    <div class="settings-grid">
      <!-- 主题与外观 -->
      <div class="setting-card">
        <h3>主题与外观</h3>
        <h4 class="section-title">纯色背景</h4>
        <div class="bg-options">
          <div
            v-for="bg in backgrounds"
            :key="bg.value"
            class="bg-option"
            :class="{ active: form.selectedBackground === bg.value }"
            :style="bg.style"
            :title="bg.label"
            @click="form.selectedBackground = bg.value; form.backgroundType = bg.type; save()"
          />
          <div class="bg-option bg-none" :class="{ active: !form.selectedBackground }" title="无背景" @click="form.selectedBackground = ''; form.backgroundType = 'none'; save()">无</div>
        </div>
        <h4 class="section-title">界面元素</h4>
        <div class="setting-option"><span>显示搜索框</span><label class="switch"><input type="checkbox" v-model="form.showSearchBox" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>显示欢迎消息</span><label class="switch"><input type="checkbox" v-model="form.showWelcomeMessage" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>显示页脚</span><label class="switch"><input type="checkbox" v-model="form.showFooter" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>新标签页打开链接</span><label class="switch"><input type="checkbox" v-model="form.openInNewTab" @change="save"><span class="slider round"></span></label></div>
        <h4 class="section-title">快捷链接</h4>
        <div class="setting-option"><span>历史记录</span><label class="switch"><input type="checkbox" v-model="form.showHistoryLink" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>下载记录</span><label class="switch"><input type="checkbox" v-model="form.showDownloadsLink" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>密码管理</span><label class="switch"><input type="checkbox" v-model="form.showPasswordsLink" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>扩展管理</span><label class="switch"><input type="checkbox" v-model="form.showExtensionsLink" @change="save"><span class="slider round"></span></label></div>
      </div>
      <!-- 搜索与布局 -->
      <div style="display:flex;flex-direction:column;gap:20px;">
        <div class="setting-card">
          <h3>搜索设置</h3>
          <div class="setting-option"><span>显示搜索建议</span><label class="switch"><input type="checkbox" v-model="form.showSearchSuggestions" @change="save"><span class="slider round"></span></label></div>
          <div class="setting-option"><span>历史记录建议</span><label class="switch"><input type="checkbox" v-model="form.showHistorySuggestions" @change="save"><span class="slider round"></span></label></div>
          <div class="setting-option"><span>书签建议</span><label class="switch"><input type="checkbox" v-model="form.showBookmarkSuggestions" @change="save"><span class="slider round"></span></label></div>
          <div class="setting-option"><span>提示词建议</span><label class="switch"><input type="checkbox" v-model="form.showPromptSuggestions" @change="save"><span class="slider round"></span></label></div>
          <div class="setting-option"><span>新标签页打开搜索结果</span><label class="switch"><input type="checkbox" v-model="form.openSearchInNewTab" @change="save"><span class="slider round"></span></label></div>
        </div>
        <div class="setting-card">
          <h3>书签布局</h3>
          <div class="setting-row">
            <label>卡片宽度</label>
            <input type="range" min="100" max="300" step="10" v-model.number="form.bookmarkWidth" @change="save">
            <span class="val">{{ form.bookmarkWidth }}px <em class="estimate">≈{{ cardsPerRow }}个/行</em></span>
          </div>
          <div class="setting-row">
            <label>卡片高度</label>
            <input type="range" min="36" max="80" step="2" v-model.number="form.bookmarkCardHeight" @change="save">
            <span class="val">{{ form.bookmarkCardHeight }}px</span>
          </div>
          <div class="setting-row">
            <label>容器宽度</label>
            <input type="range" min="50" max="100" step="5" v-model.number="form.bookmarkContainerWidth" @change="save">
            <span class="val">{{ form.bookmarkContainerWidth }}%</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin', ssr: false })
useHead({ title: '个人设置' })
const backgrounds = [
  { value: 'gradient-background-1', label: '渐变1', type: 'gradient', style: { background: 'linear-gradient(0deg, rgba(226,232,240,0) 0%, #cbd5e1 100%)' } },
  { value: 'gradient-background-2', label: '渐变2', type: 'gradient', style: { background: 'linear-gradient(0deg, rgba(165,243,252,0) 0%, #f4fbff 50%, #bfdbfe 100%)' } },
  { value: 'gradient-background-3', label: '渐变3', type: 'gradient', style: { background: 'linear-gradient(0deg, rgba(251,206,232,0) 0%, #f2d2f4 50%, #e9d5ff 100%)' } },
  { value: 'gradient-background-4', label: '渐变4', type: 'gradient', style: { background: 'linear-gradient(0deg, #f2f8f0 0%, #f2f8f0 100%)' } },
  { value: 'gradient-background-5', label: '渐变5', type: 'gradient', style: { background: 'linear-gradient(0deg, #fcfcf7 0%, #fcfcf7 100%)' } },
  { value: 'gradient-background-6', label: '渐变6', type: 'gradient', style: { background: 'linear-gradient(0deg, #f4f1f8 0%, #f4f1f8 100%)' } },
  { value: 'gradient-background-7', label: '渐变7', type: 'gradient', style: { background: 'linear-gradient(0deg, #f8f7f4 0%, #f8f7f4 100%)' } },
]
const settingsStore = useSettingsStore()

// 确保设置已加载（auth-init 插件已 fetch，此处兜底）
if (!settingsStore.isLoading && Object.keys(settingsStore.settings).length === 0) {
  const auth = useAuthStore()
  await settingsStore.fetchSettings(auth.token || undefined)
}

// 从 settingsStore 初始化表单
const form = reactive<Record<string, any>>({
  selectedBackground: settingsStore.get('selectedBackground', 'gradient-background-7'),
  backgroundType: settingsStore.get('backgroundType', 'none'),
  showSearchBox: settingsStore.get('showSearchBox', true),
  showWelcomeMessage: settingsStore.get('showWelcomeMessage', true),
  showFooter: settingsStore.get('showFooter', true),
  openInNewTab: settingsStore.get('openInNewTab', true),
  showHistoryLink: settingsStore.get('showHistoryLink', true),
  showDownloadsLink: settingsStore.get('showDownloadsLink', true),
  showPasswordsLink: settingsStore.get('showPasswordsLink', true),
  showExtensionsLink: settingsStore.get('showExtensionsLink', true),
  showSearchSuggestions: settingsStore.get('showSearchSuggestions', true),
  showHistorySuggestions: settingsStore.get('showHistorySuggestions', true),
  showBookmarkSuggestions: settingsStore.get('showBookmarkSuggestions', true),
  showPromptSuggestions: settingsStore.get('showPromptSuggestions', true),
  openSearchInNewTab: settingsStore.get('openSearchInNewTab', true),
  bookmarkWidth: settingsStore.get('bookmarkWidth', 200),
  bookmarkCardHeight: settingsStore.get('bookmarkCardHeight', 50),
  bookmarkContainerWidth: settingsStore.get('bookmarkContainerWidth', 85),
})
function save() {
  settingsStore.setManyNow({ ...form })
}
// 每行卡片数量预估（基于 1440px 视口宽度）
const cardsPerRow = computed(() => {
  const viewportWidth = 1440
  const containerPx = viewportWidth * (form.bookmarkContainerWidth || 85) / 100
  const cardWidth = form.bookmarkWidth || 200
  const gap = 16
  return Math.max(1, Math.floor((containerPx + gap) / (cardWidth + gap)))
})
</script>
